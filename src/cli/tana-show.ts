#!/usr/bin/env bun

/**
 * Tana Show CLI - Display full contents of a Tana node
 *
 * Usage:
 *   tana-show <node-id>                    # Show node by ID
 *   tana-show --tagged <tagname>           # Show latest node with tag
 *   tana-show --tagged <tagname> --limit 3 # Show latest 3 nodes with tag
 */

import { Command } from "commander";
import { existsSync } from "fs";
import { Database } from "bun:sqlite";
import { getDatabasePath } from "../config/paths";
import { withDbRetrySync } from "../db/retry";
import { VERSION } from "../version";

const program = new Command();
// Default database path - uses XDG paths with legacy fallback
const DEFAULT_DB_PATH = getDatabasePath();

interface NodeData {
  id: string;
  name: string | null;
  created: number | null;
  rawData: string;
}

interface FieldValue {
  fieldName: string;
  fieldId: string;
  value: string;
  valueId: string;
}

interface NodeContents {
  id: string;
  name: string;
  created: Date | null;
  fields: FieldValue[];
  children: Array<{ id: string; name: string; isContent: boolean }>;
  tags: string[];
}

/**
 * Extract and resolve node contents from the database
 */
function getNodeContents(db: Database, nodeId: string): NodeContents | null {
  // Get the main node
  const nodeResult = withDbRetrySync(
    () => db
      .query("SELECT id, name, created, raw_data as rawData FROM nodes WHERE id = ?")
      .get(nodeId) as NodeData | null,
    "tana-show getNodeContents"
  );

  if (!nodeResult) {
    return null;
  }

  const rawData = JSON.parse(nodeResult.rawData);
  const childIds: string[] = rawData.children || [];

  // Get all children in one query
  const placeholders = childIds.map(() => "?").join(",");
  const childrenData =
    childIds.length > 0
      ? withDbRetrySync(
          () => db
            .query(
              `SELECT id, name, raw_data as rawData FROM nodes WHERE id IN (${placeholders})`
            )
            .all(...childIds) as NodeData[],
          "tana-show getNodeContents children"
        )
      : [];

  const childMap = new Map(childrenData.map((c) => [c.id, c]));

  const fields: FieldValue[] = [];
  const contentChildren: Array<{ id: string; name: string; isContent: boolean }> = [];
  const tags: string[] = [];

  // Process each child
  for (const childId of childIds) {
    const child = childMap.get(childId);
    if (!child) continue;

    const childRaw = JSON.parse(child.rawData);

    // Check if it's a tuple (field)
    if (childRaw.props?._docType === "tuple") {
      const tupleChildren: string[] = childRaw.children || [];

      if (tupleChildren.length >= 1) {
        // Resolve all children to determine field name vs value
        const resolvedPlaceholders = tupleChildren.map(() => "?").join(",");
        const resolvedNodes =
          tupleChildren.length > 0
            ? withDbRetrySync(
                () => db
                  .query(
                    `SELECT id, name FROM nodes WHERE id IN (${resolvedPlaceholders})`
                  )
                  .all(...tupleChildren) as Array<{ id: string; name: string | null }>,
                "tana-show resolvedNodes"
              )
            : [];

        const resolvedMap = new Map(resolvedNodes.map((n) => [n.id, n.name]));

        // Determine field name (usually has ⚙️ prefix or is a system field)
        let fieldName = "";
        let fieldId = "";
        const values: string[] = [];
        let valueId = "";

        for (const id of tupleChildren) {
          const name = resolvedMap.get(id);
          const mappedName = getFieldNameFromDb(db, id);

          if (id.startsWith("SYS_")) {
            // System field like Due date
            fieldName = mappedName;
            fieldId = id;
          } else if (mappedName !== id) {
            // Known field ID (mapped in field_names table)
            fieldName = mappedName;
            fieldId = id;
          } else if (name?.startsWith("⚙️") || isFieldName(name)) {
            fieldName = name || id;
            fieldId = id;
          } else {
            // This is a value
            const formattedValue = formatValue(name, id);
            values.push(formattedValue);
            if (!valueId) valueId = id;
          }
        }

        // If we found a field and at least one meaningful value, add it
        // Skip if all values are just Tana IDs (12+ char alphanumeric with possible _ or -)
        // But keep dates (YYYY-MM-DD format) and short meaningful values
        const meaningfulValues = values.filter(v => {
          // Keep dates
          if (v.match(/^\d{4}-\d{2}-\d{2}/)) return true;
          // Keep node references
          if (v.startsWith("[[")) return true;
          // Filter out bare Tana IDs (12+ chars, alphanumeric with _ or -)
          if (v.match(/^[a-zA-Z0-9_-]{12,}$/)) return false;
          return true;
        });
        if (fieldName && meaningfulValues.length > 0) {
          fields.push({
            fieldName,
            fieldId,
            value: meaningfulValues.join(", "),
            valueId
          });
        }
      }
    } else {
      // Regular content child
      contentChildren.push({
        id: childId,
        name: child.name || "(unnamed)",
        isContent: true,
      });
    }
  }

  // Get tags for this node
  const tagResults = withDbRetrySync(
    () => db
      .query("SELECT tag_name FROM tag_applications WHERE data_node_id = ?")
      .all(nodeId) as Array<{ tag_name: string }>,
    "tana-show getTags"
  );

  tags.push(...tagResults.map((t) => t.tag_name));

  return {
    id: nodeId,
    name: nodeResult.name || "(unnamed)",
    created: nodeResult.created ? new Date(nodeResult.created) : null,
    fields,
    children: contentChildren,
    tags,
  };
}

/**
 * Get field name from database or fallback to hardcoded mappings
 * Some fields have no name in the Tana export (they're referenced by ID only)
 */
function getFieldNameFromDb(db: Database, fieldId: string): string {
  // First try the field_names table (populated during indexing)
  const result = withDbRetrySync(
    () => db
      .query("SELECT field_name FROM field_names WHERE field_id = ?")
      .get(fieldId) as { field_name: string } | null,
    "tana-show getFieldNameFromDb"
  );

  if (result?.field_name) {
    return result.field_name;
  }

  // Fallback for fields that have no name in the database
  // These are fields that exist as references but have no corresponding node
  const fallbackFields: Record<string, string> = {
    // System fields
    SYS_A13: "Tag",
    SYS_A61: "Due date",
    SYS_A90: "Date",
    SYS_A142: "Attendees",
    SYS_T01: "Supertag",
    SYS_T02: "Field",
    // Meeting supertag fields (no node with name)
    Mp2A7_2PQw: "Attendees",
  };

  return fallbackFields[fieldId] || fieldId;
}

function isFieldName(name: string | null | undefined): boolean {
  if (!name) return false;
  // Field names often start with ⚙️ or are known field patterns
  return (
    name.startsWith("⚙️") ||
    ["Outcome", "Origin", "Focus", "Status", "Vault", "Due date", "Do date"].includes(
      name
    )
  );
}

function formatValue(name: string | null | undefined, id: string): string {
  if (!name) return id;

  // Handle inline date references (with HTML entity encoding)
  if (name.includes("data-inlineref-date")) {
    // Decode HTML entities first
    const decoded = name
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    const match = decoded.match(/dateTimeString":\s*"([^"]+)"/);
    if (match) {
      return match[1]; // Return just the date string like "2026-01-14"
    }
  }

  // Handle inline node references
  if (name.includes("data-inlineref-node")) {
    const match = name.match(/data-inlineref-node="([^"]+)"/);
    if (match) {
      return `[[${match[1]}]]`;
    }
  }

  return name;
}

function formatNodeOutput(contents: NodeContents, indent: string = ""): string {
  const lines: string[] = [];

  // Node name with tags
  const tagStr = contents.tags.length > 0 ? ` #${contents.tags.join(" #")}` : "";
  lines.push(`${indent}📄 ${contents.name}${tagStr}`);

  if (contents.created) {
    lines.push(`${indent}   Created: ${contents.created.toLocaleDateString()}`);
  }

  // Fields
  if (contents.fields.length > 0) {
    lines.push(`${indent}   Fields:`);
    for (const field of contents.fields) {
      lines.push(`${indent}   - ${field.fieldName}:: ${field.value}`);
    }
  }

  // Content children
  if (contents.children.length > 0) {
    lines.push(`${indent}   Children:`);
    for (const child of contents.children) {
      lines.push(`${indent}   - ${child.name}`);
    }
  }

  return lines.join("\n");
}

program
  .name("tana-show")
  .description("Display full contents of a Tana node")
  .version(VERSION);

program
  .command("node <node-id>")
  .description("Show contents of a specific node by ID")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--json", "Output as JSON", false)
  .action((nodeId, options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const db = new Database(options.dbPath);
    const contents = getNodeContents(db, nodeId);
    db.close();

    if (!contents) {
      console.error(`❌ Node not found: ${nodeId}`);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(contents, null, 2));
    } else {
      console.log(formatNodeOutput(contents));
    }
  });

program
  .command("tagged <tagname>")
  .description("Show contents of nodes with a specific tag")
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--limit <n>", "Number of nodes to show", "1")
  .option("--json", "Output as JSON", false)
  .option("-i, --case-insensitive", "Case-insensitive tag matching", false)
  .action((tagname, options) => {
    if (!existsSync(options.dbPath)) {
      console.error(`❌ Database not found: ${options.dbPath}`);
      process.exit(1);
    }

    const db = new Database(options.dbPath);
    const limit = parseInt(options.limit);

    // Find nodes with this tag
    let nodeIds = withDbRetrySync(
      () => db
        .query(
          `
        SELECT DISTINCT ta.data_node_id as id
        FROM tag_applications ta
        JOIN nodes n ON n.id = ta.data_node_id
        WHERE ta.tag_name = ?
        ORDER BY n.created DESC
        LIMIT ?
      `
        )
        .all(tagname, limit) as Array<{ id: string }>,
      "tana-show findTaggedNodes"
    );

    // Try case-insensitive if no results
    if (nodeIds.length === 0 && options.caseInsensitive) {
      const alternates = [
        tagname.toLowerCase(),
        tagname.charAt(0).toUpperCase() + tagname.slice(1).toLowerCase(),
        tagname.toUpperCase(),
      ];
      for (const alt of alternates) {
        if (alt === tagname) continue;
        nodeIds = withDbRetrySync(
          () => db
            .query(
              `
            SELECT DISTINCT ta.data_node_id as id
            FROM tag_applications ta
            JOIN nodes n ON n.id = ta.data_node_id
            WHERE ta.tag_name = ?
            ORDER BY n.created DESC
            LIMIT ?
          `
            )
            .all(alt, limit) as Array<{ id: string }>,
          "tana-show findTaggedNodes alt"
        );
        if (nodeIds.length > 0) {
          tagname = alt;
          break;
        }
      }
    }

    if (nodeIds.length === 0) {
      console.error(`❌ No nodes found with tag "#${tagname}"`);
      db.close();
      process.exit(1);
    }

    const allContents: NodeContents[] = [];
    for (const { id } of nodeIds) {
      const contents = getNodeContents(db, id);
      if (contents) {
        allContents.push(contents);
      }
    }

    db.close();

    if (options.json) {
      console.log(JSON.stringify(allContents, null, 2));
    } else {
      console.log(`\n🏷️  Nodes tagged with #${tagname} (${allContents.length}):\n`);
      for (const contents of allContents) {
        console.log(formatNodeOutput(contents));
        console.log();
      }
    }
  });

program.parse();
