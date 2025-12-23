/**
 * Tags Command Group
 *
 * Consolidates supertag operations:
 * - tags list     - List all supertags with counts (replaces query tags)
 * - tags top      - Most-used supertags (replaces query top-tags)
 * - tags show     - Show tag schema fields (replaces schema show)
 *
 * Usage:
 *   supertag tags list --limit 50          # List all tags
 *   supertag tags top --limit 10           # Top 10 by usage
 *   supertag tags show todo                # Show todo tag schema
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import { TanaQueryEngine } from "../query/tana-query-engine";
import { getSchemaRegistry } from "./schema";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
} from "./helpers";
import type { StandardOptions } from "../types";
import {
  tsv,
  EMOJI,
  header,
  table,
  formatNumber,
  tip,
} from "../utils/format";
import { resolveOutputOptions } from "../utils/output-options";
import { SupertagMetadataService } from "../services/supertag-metadata-service";

interface TagsMetadataOptions extends StandardOptions {
  flat?: boolean;
  all?: boolean;
  inherited?: boolean;
  own?: boolean;
}

/**
 * Create the tags command group
 */
export function createTagsCommand(): Command {
  const tags = new Command("tags");
  tags.description("Explore and manage supertags");

  // tags list
  const listCmd = tags
    .command("list")
    .description("List all supertags with counts");

  addStandardOptions(listCmd, { defaultLimit: "50" });

  listCmd.action(async (options: StandardOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const engine = new TanaQueryEngine(dbPath);
    const limit = options.limit ? parseInt(String(options.limit)) : 50;

    try {
      const allTags = await engine.getTopSupertags(limit);

      if (options.json) {
        console.log(formatJsonOutput(allTags));
      } else {
        console.log(`\n🏷️  Supertags (${allTags.length}):\n`);
        allTags.forEach((tag, i) => {
          console.log(`${i + 1}. ${tag.tagName} (${tag.count} nodes)`);
          console.log(`   ID: ${tag.tagId}`);
          console.log();
        });
      }
    } finally {
      engine.close();
    }
  });

  // tags top
  const topCmd = tags
    .command("top")
    .description("Show most-used supertags by application count");

  addStandardOptions(topCmd, { defaultLimit: "20" });

  topCmd.action(async (options: StandardOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const engine = new TanaQueryEngine(dbPath);
    const limit = options.limit ? parseInt(String(options.limit)) : 20;
    const outputOpts = resolveOutputOptions(options);

    try {
      const topTags = await engine.getTopTagsByUsage(limit);

      if (options.json) {
        console.log(formatJsonOutput(topTags));
      } else if (outputOpts.pretty) {
        // Pretty mode: emojis, table formatting
        console.log(`\n${header(EMOJI.tags, `Top ${topTags.length} supertags by usage`)}\n`);
        const headers = outputOpts.verbose
          ? ['Rank', 'Tag', 'Count', 'ID']
          : ['Rank', 'Tag', 'Count'];
        const rows = topTags.map((tag, i) => {
          const row = [
            String(i + 1),
            `#${tag.tagName}`,
            formatNumber(tag.count, true),
          ];
          if (outputOpts.verbose) {
            row.push(tag.tagId);
          }
          return row;
        });
        const align = outputOpts.verbose
          ? ['right', 'left', 'right', 'left'] as const
          : ['right', 'left', 'right'] as const;
        console.log(table(headers, rows, { align: [...align] }));
        console.log(tip("Use 'search --tag <name>' to find nodes with a tag"));
      } else {
        // Unix mode: TSV output, pipe-friendly
        // Format: tagName\tcount (or with --verbose: tagId\ttagName\tcount)
        for (const tag of topTags) {
          if (outputOpts.verbose) {
            console.log(tsv(tag.tagId, tag.tagName, tag.count));
          } else {
            console.log(tsv(tag.tagName, tag.count));
          }
        }
      }
    } finally {
      engine.close();
    }
  });

  // tags show <tagname>
  const showCmd = tags
    .command("show <tagname>")
    .description("Show schema fields for a supertag");

  addStandardOptions(showCmd, { defaultLimit: "1" });

  showCmd.action(async (tagname: string, options: StandardOptions) => {
    // Load schema registry from cache
    const registry = getSchemaRegistry(options.workspace);

    // Find the tag
    const tag = registry.findTagByName(tagname);

    if (!tag) {
      console.error(`❌ Supertag not found: ${tagname}`);
      console.error(`   Available tags can be listed with: supertag tags list`);
      process.exit(1);
    }

    if (options.json) {
      console.log(formatJsonOutput(tag));
    } else {
      console.log(`\n🏷️  ${tag.name}`);
      console.log(`   ID: ${tag.id}`);
      console.log(`   Color: ${tag.color || "(none)"}`);

      if (tag.fields && tag.fields.length > 0) {
        console.log(`\n   Fields (${tag.fields.length}):`);
        tag.fields.forEach((field: { name: string; attributeId: string; dataType?: string }) => {
          console.log(`   - ${field.name} (${field.attributeId})`);
          if (field.dataType) {
            console.log(`     Type: ${field.dataType}`);
          }
        });
      } else {
        console.log(`\n   No fields defined`);
      }
      console.log();
    }
  });

  // tags inheritance <tagname>
  const inheritanceCmd = tags
    .command("inheritance <tagname>")
    .description("Show inheritance chain for a supertag")
    .option("--flat", "Show flattened list instead of tree");

  addStandardOptions(inheritanceCmd, { defaultLimit: "1" });

  inheritanceCmd.action(async (tagname: string, options: TagsMetadataOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const db = new Database(dbPath);
    const service = new SupertagMetadataService(db);

    try {
      // Find tag ID by name
      const tagId = service.findTagIdByName(tagname);
      if (!tagId) {
        console.error(`❌ Supertag not found: ${tagname}`);
        process.exit(1);
      }

      if (options.json) {
        const chain = service.getInheritanceChain(tagId);
        console.log(formatJsonOutput(chain));
      } else if (options.flat) {
        // Flattened list of ancestors with depth
        const ancestors = service.getAncestors(tagId);
        console.log(`\n🏷️  ${tagname} inheritance:\n`);
        if (ancestors.length === 0) {
          console.log("   (no parent supertags)");
        } else {
          for (const ancestor of ancestors) {
            // Use getTagName which falls back to nodes table for tagDefs without fields
            const name = service.getTagName(ancestor.tagId) || ancestor.tagId;
            console.log(`   ${"  ".repeat(ancestor.depth - 1)}↳ ${name} (depth: ${ancestor.depth})`);
          }
        }
        console.log();
      } else {
        // Tree view
        const chain = service.getInheritanceChain(tagId);
        console.log(`\n🏷️  ${tagname} inheritance:\n`);
        printInheritanceTree(chain, 0);
        console.log();
      }
    } finally {
      db.close();
    }
  });

  // tags fields <tagname>
  const fieldsCmd = tags
    .command("fields <tagname>")
    .description("Show fields for a supertag")
    .option("--all", "Show all fields including inherited")
    .option("--inherited", "Show only inherited fields")
    .option("--own", "Show only own fields (default without flags)");

  addStandardOptions(fieldsCmd, { defaultLimit: "100" });

  fieldsCmd.action(async (tagname: string, options: TagsMetadataOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const db = new Database(dbPath);
    const service = new SupertagMetadataService(db);

    try {
      // Find tag ID by name
      const tagId = service.findTagIdByName(tagname);
      if (!tagId) {
        console.error(`❌ Supertag not found: ${tagname}`);
        process.exit(1);
      }

      let fields: Array<{ fieldName: string; originTagName: string; depth: number }>;

      if (options.all) {
        // All fields including inherited
        fields = service.getAllFields(tagId).map(f => ({
          fieldName: f.fieldName,
          originTagName: f.originTagName,
          depth: f.depth,
        }));
      } else if (options.inherited) {
        // Only inherited fields (depth > 0)
        fields = service.getAllFields(tagId)
          .filter(f => f.depth > 0)
          .map(f => ({
            fieldName: f.fieldName,
            originTagName: f.originTagName,
            depth: f.depth,
          }));
      } else {
        // Default: own fields only (depth === 0)
        fields = service.getFields(tagId).map(f => ({
          fieldName: f.fieldName,
          originTagName: f.tagName,
          depth: 0,
        }));
      }

      if (options.json) {
        console.log(formatJsonOutput(fields));
      } else {
        const modeLabel = options.all ? "all" : options.inherited ? "inherited" : "own";
        console.log(`\n🏷️  ${tagname} fields (${modeLabel}):\n`);
        if (fields.length === 0) {
          console.log("   (no fields)");
        } else {
          for (const field of fields) {
            if (field.depth > 0) {
              console.log(`   - ${field.fieldName} (from ${field.originTagName})`);
            } else {
              console.log(`   - ${field.fieldName}`);
            }
          }
        }
        console.log();
      }
    } finally {
      db.close();
    }
  });

  return tags;
}

/**
 * Print inheritance tree recursively
 */
function printInheritanceTree(node: { tagId: string; tagName: string; parents: Array<{ tagId: string; tagName: string; parents: any[] }> }, indent: number): void {
  const prefix = indent === 0 ? "" : "  ".repeat(indent - 1) + "↳ ";
  console.log(`   ${prefix}${node.tagName}`);
  for (const parent of node.parents) {
    printInheritanceTree(parent, indent + 1);
  }
}
