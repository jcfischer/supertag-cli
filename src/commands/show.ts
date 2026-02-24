/**
 * Node Display Helpers
 *
 * Helper functions for displaying Tana node contents.
 * Used by nodes.ts, embed.ts, and other commands.
 *
 * Note: Legacy show commands removed in v1.0.0 - use harmonized commands:
 * - supertag nodes show <id>
 * - supertag search <query> --tag <tag>
 */
import { existsSync } from "fs";
import { Database } from "bun:sqlite";
import { getDatabasePath } from "../config/paths";
import { resolveWorkspaceContext } from "../config/workspace-resolver";
import { withDbRetrySync } from "../db/retry";
import { formatInlineRefs } from "../utils/inline-ref-formatter";

// Default database path - uses XDG with legacy fallback
const DEFAULT_DB_PATH = getDatabasePath();

/** Tana docTypes that represent calendar/day page nodes with nested section structure */
const CALENDAR_DOC_TYPES = new Set(["journalPart", "journal"]);

/** Default depth for calendar nodes — depth 2 surfaces children of section headers (Todos, Notes, etc.) */
const CALENDAR_DEFAULT_DEPTH = 2;

/**
 * Check if a node is a calendar/day page node by examining its _docType.
 * Calendar nodes (journalPart = day/week pages, journal = calendar root)
 * have nested section structure where depth 0 only shows headers.
 */
export function isCalendarNode(db: Database, nodeId: string): boolean {
  const result = withDbRetrySync(
    () => db
      .query("SELECT json_extract(raw_data, '$.props._docType') as docType FROM nodes WHERE id = ?")
      .get(nodeId) as { docType: string | null } | null,
    "isCalendarNode"
  );
  return result?.docType ? CALENDAR_DOC_TYPES.has(result.docType) : false;
}

/**
 * Resolve the effective depth for a node.
 * If the user didn't explicitly set --depth, calendar nodes default to 1.
 */
export function resolveEffectiveDepth(
  db: Database,
  nodeId: string,
  requestedDepth: number,
  depthExplicitlySet: boolean
): number {
  if (depthExplicitlySet) {
    return requestedDepth;
  }
  if (requestedDepth === 0 && isCalendarNode(db, nodeId)) {
    return CALENDAR_DEFAULT_DEPTH;
  }
  return requestedDepth;
}

/**
 * Resolve the database path from options
 * Priority: --db-path > --workspace > default workspace > legacy
 */
function resolveDbPath(options: { dbPath?: string; workspace?: string }): string {
  // Explicit db-path takes precedence
  if (options.dbPath && options.dbPath !== DEFAULT_DB_PATH) {
    return options.dbPath;
  }

  // Use unified workspace resolver
  const ws = resolveWorkspaceContext({
    workspace: options.workspace,
    requireDatabase: false,
  });
  return ws.dbPath;
}

export interface NodeData {
  id: string;
  name: string | null;
  created: number | null;
  rawData: string;
}

export interface FieldValue {
  fieldName: string;
  fieldId: string;
  value: string;
  valueId: string;
}

export interface NodeContents {
  id: string;
  name: string;
  created: Date | null;
  fields: FieldValue[];
  children: Array<{ id: string; name: string; isContent: boolean }>;
  tags: string[];
}

export interface NodeContentsWithChildren extends Omit<NodeContents, 'children'> {
  children: NodeContentsWithChildren[];
}

function checkDb(dbPath: string): boolean {
  if (!existsSync(dbPath)) {
    console.error(`❌ Database not found: ${dbPath}`);
    console.error(`   Run 'supertag sync index' first`);
    return false;
  }
  return true;
}

/**
 * Get field name from database or fallback to hardcoded mappings
 */
function getFieldNameFromDb(db: Database, fieldId: string): string {
  const result = withDbRetrySync(
    () => db
      .query("SELECT field_name FROM field_names WHERE field_id = ?")
      .get(fieldId) as { field_name: string } | null,
    "getFieldNameFromDb"
  );

  if (result?.field_name) {
    return result.field_name;
  }

  const fallbackFields: Record<string, string> = {
    SYS_A13: "Tag",
    SYS_A61: "Due date",
    SYS_A90: "Date",
    SYS_A142: "Attendees",
    SYS_T01: "Supertag",
    SYS_T02: "Field",
    Mp2A7_2PQw: "Attendees",
  };

  return fallbackFields[fieldId] || fieldId;
}

function isFieldName(name: string | null | undefined): boolean {
  if (!name) return false;
  return (
    name.startsWith("⚙️") ||
    ["Outcome", "Origin", "Focus", "Status", "Vault", "Due date", "Do date"].includes(name)
  );
}

function formatValue(name: string | null | undefined, id: string): string {
  if (!name) return id;
  return formatInlineRefs(name, { fallback: id });
}

/**
 * Check if field_values table exists in the database
 */
function hasFieldValuesTable(db: Database): boolean {
  const result = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='field_values'")
    .get() as { name: string } | null;
  return result !== null;
}

/**
 * Extract and resolve node contents from the database
 *
 * Uses field_values table when available (preferred - has correct field names).
 * Falls back to tuple parsing when field_values is not available.
 */
export function getNodeContents(db: Database, nodeId: string): NodeContents | null {
  const nodeResult = withDbRetrySync(
    () => db
      .query("SELECT id, name, created, raw_data as rawData FROM nodes WHERE id = ? AND (node_type IS NULL OR node_type != 'trash')")
      .get(nodeId) as NodeData | null,
    "getNodeContents"
  );

  if (!nodeResult) {
    return null;
  }

  const rawData = JSON.parse(nodeResult.rawData);
  const childIds: string[] = rawData.children || [];

  // Get children data for content children identification
  const placeholders = childIds.map(() => "?").join(",");
  const childrenData =
    childIds.length > 0
      ? withDbRetrySync(
          () => db
            .query(
              `SELECT id, name, raw_data as rawData FROM nodes WHERE id IN (${placeholders})`
            )
            .all(...childIds) as NodeData[],
          "getNodeContents children"
        )
      : [];

  const childMap = new Map(childrenData.map((c) => [c.id, c]));

  const fields: FieldValue[] = [];
  const contentChildren: Array<{ id: string; name: string; isContent: boolean }> = [];
  const tags: string[] = [];

  // Collect tuple IDs for exclusion from content children
  const tupleIds = new Set<string>();

  // Try to get fields from field_values table (preferred method)
  if (hasFieldValuesTable(db)) {
    const fieldValuesResult = withDbRetrySync(
      () => db
        .query(`
          SELECT field_name, field_def_id, value_text, value_node_id, value_order
          FROM field_values
          WHERE parent_id = ?
          ORDER BY field_name, value_order
        `)
        .all(nodeId) as Array<{
          field_name: string;
          field_def_id: string;
          value_text: string;
          value_node_id: string;
          value_order: number;
        }>,
      "getNodeContents field_values"
    );

    // Group values by field name
    const fieldGroups = new Map<string, { fieldId: string; values: string[]; valueId: string }>();

    for (const row of fieldValuesResult) {
      const formattedValue = formatValue(row.value_text, row.value_node_id);

      if (!fieldGroups.has(row.field_name)) {
        fieldGroups.set(row.field_name, {
          fieldId: row.field_def_id,
          values: [],
          valueId: row.value_node_id,
        });
      }
      fieldGroups.get(row.field_name)!.values.push(formattedValue);
    }

    // Convert to FieldValue array
    for (const [fieldName, data] of fieldGroups) {
      const meaningfulValues = data.values.filter(v => {
        if (v.match(/^\d{4}-\d{2}-\d{2}/)) return true;
        if (v.startsWith("[[")) return true;
        if (v.match(/^[a-zA-Z0-9_-]{12,}$/)) return false;
        return true;
      });

      if (meaningfulValues.length > 0) {
        fields.push({
          fieldName,
          fieldId: data.fieldId,
          value: meaningfulValues.join(", "),
          valueId: data.valueId,
        });
      }
    }
  }

  // Identify content children (non-tuple children)
  for (const childId of childIds) {
    const child = childMap.get(childId);
    if (!child) continue;

    const childRaw = JSON.parse(child.rawData);

    if (childRaw.props?._docType === "tuple") {
      tupleIds.add(childId);
    } else {
      contentChildren.push({
        id: childId,
        name: child.name || "(unnamed)",
        isContent: true,
      });
    }
  }

  // Get tags
  const tagResults = withDbRetrySync(
    () => db
      .query("SELECT tag_name FROM tag_applications WHERE data_node_id = ?")
      .all(nodeId) as Array<{ tag_name: string }>,
    "getNodeContents tags"
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

export function formatNodeOutput(contents: NodeContents, indent: string = ""): string {
  const lines: string[] = [];

  const tagStr = contents.tags.length > 0 ? ` #${contents.tags.join(" #")}` : "";
  lines.push(`${indent}📄 ${contents.name}${tagStr}`);

  if (contents.created) {
    lines.push(`${indent}   Created: ${contents.created.toLocaleDateString()}`);
  }

  if (contents.fields.length > 0) {
    lines.push(`${indent}   Fields:`);
    for (const field of contents.fields) {
      lines.push(`${indent}   - ${field.fieldName}:: ${field.value}`);
    }
  }

  if (contents.children.length > 0) {
    lines.push(`${indent}   Children:`);
    for (const child of contents.children) {
      lines.push(`${indent}   - ${child.name}`);
    }
  }

  return lines.join("\n");
}

/**
 * Recursively build node contents with depth traversal for JSON output
 */
export function getNodeContentsWithDepth(
  db: Database,
  nodeId: string,
  currentDepth: number,
  maxDepth: number
): NodeContentsWithChildren | null {
  const contents = getNodeContents(db, nodeId);
  if (!contents) return null;

  const result: NodeContentsWithChildren = {
    id: contents.id,
    name: contents.name,
    created: contents.created,
    fields: contents.fields,
    tags: contents.tags,
    children: [],
  };

  // Recurse into children if within depth limit
  if (currentDepth < maxDepth && contents.children.length > 0) {
    for (const child of contents.children) {
      const childContents = getNodeContentsWithDepth(
        db,
        child.id,
        currentDepth + 1,
        maxDepth
      );
      if (childContents) {
        result.children.push(childContents);
      }
    }
  }

  return result;
}

/**
 * Recursively format node output with depth traversal
 */
export function formatNodeWithDepth(
  db: Database,
  nodeId: string,
  currentDepth: number,
  maxDepth: number,
  indent: string = ""
): string {
  const contents = getNodeContents(db, nodeId);
  if (!contents) return "";

  const lines: string[] = [];
  const tagStr = contents.tags.length > 0 ? ` #${contents.tags.join(" #")}` : "";

  // Node header
  lines.push(`${indent}${contents.name}${tagStr}`);

  // Fields (inline)
  if (contents.fields.length > 0) {
    for (const field of contents.fields) {
      lines.push(`${indent}  ${field.fieldName}:: ${field.value}`);
    }
  }

  // Children - recurse if within depth limit
  if (contents.children.length > 0) {
    for (const child of contents.children) {
      if (currentDepth < maxDepth) {
        // Recurse into child
        const childOutput = formatNodeWithDepth(
          db,
          child.id,
          currentDepth + 1,
          maxDepth,
          indent + "  "
        );
        if (childOutput) {
          lines.push(childOutput);
        }
      } else {
        // Just show child name at max depth
        lines.push(`${indent}  - ${child.name}`);
      }
    }
  }

  return lines.join("\n");
}

// Note: Legacy registerShowCommands removed in v1.0.0
// Use harmonized commands instead:
// - supertag nodes show <id> (replaces show node)
// - supertag search <query> --tag <tag> (replaces show tagged)
