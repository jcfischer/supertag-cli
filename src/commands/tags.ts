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
import { existsSync } from "fs";
import { withDatabase, withQueryEngine } from "../db/with-database";
import { getSchemaRegistry, getSchemaRegistryFromDatabase } from "./schema";
import { UnifiedSchemaService } from "../services/unified-schema-service";
import { SchemaRegistry } from "../schema";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
  parseSelectOption,
} from "./helpers";
import {
  parseSelectPaths,
  applyProjection,
  applyProjectionToArray,
} from "../utils/select-projection";

/**
 * Get schema registry, preferring workspace-based but falling back to database.
 * This handles the case when --db-path is provided without workspace configuration.
 */
function getSchemaRegistrySafe(dbPath: string, workspace?: string): SchemaRegistry {
  try {
    return getSchemaRegistry(workspace);
  } catch {
    // Fall back to database-based registry when workspace resolution fails
    try {
      return getSchemaRegistryFromDatabase(dbPath);
    } catch {
      // Return empty registry if database doesn't have schema data
      return new SchemaRegistry();
    }
  }
}
import type { StandardOptions } from "../types";
import {
  tsv,
  EMOJI,
  header,
  table,
  formatNumber,
  tip,
} from "../utils/format";
import { resolveOutputOptions, resolveOutputFormat } from "../utils/output-options";
import { createFormatter, type OutputFormat } from "../utils/output-formatter";
import { SupertagMetadataService } from "../services/supertag-metadata-service";
import { VisualizationService } from "../visualization/service";
import { render, supportedFormats, isFormatSupported } from "../visualization/renderers";
import type { VisualizationFormat, MermaidRenderOptions, DOTRenderOptions, HTMLRenderOptions, ThreeRenderOptions } from "../visualization/types";
import { writeFileSync } from "fs";

interface TagsMetadataOptions extends StandardOptions {
  flat?: boolean;
  all?: boolean;
  inherited?: boolean;
  own?: boolean;
}

interface VisualizeOptions extends StandardOptions {
  format?: string;
  root?: string;
  from?: string;
  depth?: number;
  minUsage?: number;
  orphans?: boolean;
  output?: string;
  open?: boolean;
  direction?: string;
  showFields?: boolean;
  showInherited?: boolean;
  colors?: boolean;
  theme?: string;
  layout?: string;
  sizeByUsage?: boolean;
}

/**
 * Tag details from database with inferred types (T-5.2)
 */
export interface TagDetails {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  color: string | null;
  fields: TagFieldDetails[];
}

/**
 * Field details with inferred data type
 */
export interface TagFieldDetails {
  name: string;
  attributeId: string;
  normalizedName: string;
  inferredDataType: string | null;
  order: number;
}

/**
 * Get tag details from database using UnifiedSchemaService (T-5.2)
 *
 * Provides access to inferred data types stored in the database.
 *
 * @param dbPath - Path to the SQLite database
 * @param tagName - Tag name to look up (exact or normalized)
 * @returns Tag details or null if not found
 */
export async function getTagDetailsFromDatabase(dbPath: string, tagName: string): Promise<TagDetails | null> {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  return withDatabase({ dbPath, readonly: true }, (ctx) => {
    const schemaService = new UnifiedSchemaService(ctx.db);
    const supertag = schemaService.getSupertag(tagName);

    if (!supertag) {
      return null;
    }

    return {
      id: supertag.id,
      name: supertag.name,
      normalizedName: supertag.normalizedName,
      description: supertag.description ?? null,
      color: supertag.color ?? null,
      fields: supertag.fields.map((field) => ({
        name: field.name,
        attributeId: field.attributeId,
        normalizedName: field.normalizedName,
        inferredDataType: field.dataType ?? null,
        order: field.order,
      })),
    };
  });
}

/**
 * Result of resolving a tag name to ID with duplicate detection
 */
interface TagResolutionResult {
  tagId: string;
  displayName: string;
  hasDuplicates: boolean;
}

/**
 * Resolve a tag name or ID to a tag ID, with duplicate detection and warning.
 * Returns null if not found. Outputs warning to stderr if duplicates exist.
 *
 * @param service - SupertagMetadataService instance
 * @param tagname - Tag name or ID to resolve
 * @param commandName - Command name for disambiguation hint (e.g., "show", "fields")
 */
function resolveTagWithDuplicateWarning(
  service: SupertagMetadataService,
  tagname: string,
  commandName: string
): TagResolutionResult | null {
  // Check if input looks like an ID (for direct disambiguation)
  if (service.isTagId(tagname)) {
    const foundName = service.findTagById(tagname);
    if (foundName) {
      return { tagId: tagname, displayName: foundName, hasDuplicates: false };
    }
    console.error(`❌ Supertag ID not found: ${tagname}`);
    return null;
  }

  // Find by name - check for duplicates
  const allTags = service.findAllTagsByName(tagname);

  if (allTags.length === 0) {
    console.error(`❌ Supertag not found: ${tagname}`);
    console.error(`   Available tags can be listed with: supertag tags list`);
    return null;
  }

  // Use the first (best) match
  const tagId = allTags[0].tagId;

  // Warn if there are duplicates
  if (allTags.length > 1) {
    console.error(`⚠️  Multiple supertags named "${tagname}" found. Using the one with most inheritance/fields.`);
    console.error(`   To specify exactly which one, use the ID:\n`);
    for (const tag of allTags) {
      const marker = tag.tagId === tagId ? " ← (selected)" : "";
      console.error(`   supertag tags ${commandName} ${tag.tagId}  # ${tag.usageCount} uses, ${tag.fieldCount} fields${marker}`);
    }
    console.error(`\n   💡 Tip: Rename duplicate tags in Tana to avoid confusion. Changes will be picked up on next export.\n`);
  }

  return { tagId, displayName: tagname, hasDuplicates: allTags.length > 1 };
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
    .description("List all supertags with counts")
    .option("--select <fields>", "Select specific fields to output (comma-separated, e.g., tagName,count)");

  addStandardOptions(listCmd, { defaultLimit: "50" });

  listCmd.action(async (options: StandardOptions & { select?: string; format?: OutputFormat; header?: boolean }) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const limit = options.limit ? parseInt(String(options.limit)) : 50;
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);
    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);

    await withQueryEngine({ dbPath }, async (ctx) => {
      const allTags = await ctx.engine.getTopSupertags(limit);

      // Build enriched data for all formats
      const enriched = allTags.map((tag) => ({
        tagName: tag.tagName,
        tagId: tag.tagId,
        count: tag.count,
      }));

      // Table format: use rich pretty output
      if (format === "table") {
        console.log(`\n🏷️  Supertags (${allTags.length}):\n`);
        allTags.forEach((tag, i) => {
          console.log(`${i + 1}. ${tag.tagName} (${tag.count} nodes)`);
          console.log(`   ID: ${tag.tagId}`);
          console.log();
        });
        return;
      }

      // Apply field projection for JSON formats with --select
      if (selectFields && selectFields.length > 0) {
        if (format === "json" || format === "minimal" || format === "jsonl") {
          const projectedResults = applyProjectionToArray(allTags, projection);
          console.log(formatJsonOutput(projectedResults));
          return;
        }
      }

      // Create formatter and output based on format
      const formatter = createFormatter({
        format,
        noHeader: options.header === false,
        humanDates: outputOpts.humanDates,
        verbose: outputOpts.verbose,
      });

      // Use lowercase headers for backward-compatible JSON keys
      const headers = ["tagName", "tagId", "count"];
      const rows = enriched.map((item) => [
        item.tagName,
        item.tagId,
        String(item.count),
      ]);

      formatter.table(headers, rows);
      formatter.finalize();
    });
  });

  // tags top
  const topCmd = tags
    .command("top")
    .description("Show most-used supertags by application count")
    .option("--select <fields>", "Select specific fields to output (comma-separated, e.g., tagName,count)");

  addStandardOptions(topCmd, { defaultLimit: "20" });

  topCmd.action(async (options: StandardOptions & { select?: string; format?: OutputFormat; header?: boolean }) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const limit = options.limit ? parseInt(String(options.limit)) : 20;
    const outputOpts = resolveOutputOptions(options);
    const format = resolveOutputFormat(options);
    const selectFields = parseSelectOption(options.select);
    const projection = parseSelectPaths(selectFields);

    await withQueryEngine({ dbPath }, async (ctx) => {
      const topTags = await ctx.engine.getTopTagsByUsage(limit);

      // Build enriched data for all formats
      const enriched = topTags.map((tag, i) => ({
        rank: i + 1,
        tagName: tag.tagName,
        tagId: tag.tagId,
        count: tag.count,
      }));

      // Table format: use rich pretty output
      if (format === "table") {
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
        return;
      }

      // Apply field projection for JSON formats with --select
      if (selectFields && selectFields.length > 0) {
        if (format === "json" || format === "minimal" || format === "jsonl") {
          const projectedResults = applyProjectionToArray(topTags, projection);
          console.log(formatJsonOutput(projectedResults));
          return;
        }
      }

      // Create formatter and output based on format
      const formatter = createFormatter({
        format,
        noHeader: options.header === false,
        humanDates: outputOpts.humanDates,
        verbose: outputOpts.verbose,
      });

      // Use lowercase headers for backward-compatible JSON keys
      const headers = ["rank", "tagName", "tagId", "count"];
      const rows = enriched.map((item) => [
        String(item.rank),
        item.tagName,
        item.tagId,
        String(item.count),
      ]);

      formatter.table(headers, rows);
      formatter.finalize();
    });
  });

  // tags show <tagname>
  const showCmd = tags
    .command("show <tagname>")
    .description("Show schema fields for a supertag")
    .option("--all", "Show all fields including inherited")
    .option("--select <fields>", "Select specific fields to output (comma-separated, e.g., id,name)");

  addStandardOptions(showCmd, { defaultLimit: "1" });

  showCmd.action(async (tagname: string, options: TagsMetadataOptions & { select?: string; format?: OutputFormat; header?: boolean }) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const service = new SupertagMetadataService(ctx.db);

      // Resolve tag with duplicate warning
      const resolved = resolveTagWithDuplicateWarning(service, tagname, "show");
      if (!resolved) {
        process.exit(1);
      }
      const { tagId, displayName } = resolved;

      // Get fields from service (supports --all for inherited fields)
      let fields: Array<{
        name: string;
        id: string;
        dataType?: string;
        origin?: string;
        inherited: boolean;
      }>;

      if (options.all) {
        // All fields including inherited from SupertagMetadataService
        fields = service.getAllFields(tagId).map(f => ({
          name: f.fieldName,
          id: f.fieldLabelId,
          dataType: f.inferredDataType,
          origin: f.originTagName,
          inherited: f.depth > 0,
        }));
      } else {
        // Own fields only - try schema registry first, fall back to service
        const registry = getSchemaRegistrySafe(dbPath, options.workspace);
        const tag = registry.getSupertagById(tagId) || registry.findTagByName(tagname);

        if (tag?.fields && tag.fields.length > 0) {
          fields = tag.fields.map((field: { name: string; attributeId: string; dataType?: string }) => ({
            name: field.name,
            id: field.attributeId,
            dataType: field.dataType,
            inherited: false,
          }));
        } else {
          // Fall back to service for own fields
          fields = service.getFields(tagId).map(f => ({
            name: f.fieldName,
            id: f.fieldLabelId,
            dataType: f.inferredDataType,
            inherited: false,
          }));
        }
      }

      // Get tag metadata (color) from schema registry if available
      const registryForMeta = getSchemaRegistrySafe(dbPath, options.workspace);
      const tagMeta = registryForMeta.getSupertagById(tagId);
      const color = tagMeta?.color || null;

      const selectFields = parseSelectOption(options.select);
      const projection = parseSelectPaths(selectFields);
      const outputOpts = resolveOutputOptions(options);
      const format = resolveOutputFormat(options);

      // Build result data for all formats
      const result = { id: tagId, name: displayName, color, fields };

      // Table format: use rich pretty output
      if (format === "table") {
        console.log(`\n🏷️  ${displayName}`);
        console.log(`   ID: ${tagId}`);
        console.log(`   Color: ${color || "(none)"}`);

        if (fields.length > 0) {
          const modeLabel = options.all ? "all" : "";
          console.log(`\n   Fields${modeLabel ? ` (${modeLabel})` : ""} (${fields.length}):`);
          fields.forEach((field) => {
            const lines = formatFieldLines({
              name: field.name,
              id: field.id,
              dataType: field.dataType,
              origin: field.origin,
              inherited: field.inherited,
            });
            for (const line of lines) {
              console.log(line);
            }
          });
        } else {
          console.log(`\n   No fields defined`);
        }
        console.log();
        return;
      }

      // Apply field projection for JSON formats with --select
      if (selectFields && selectFields.length > 0) {
        if (format === "json" || format === "minimal" || format === "jsonl") {
          const projected = applyProjection(result, projection);
          console.log(formatJsonOutput(projected));
          return;
        }
      }

      // JSON formats without --select
      if (format === "json" || format === "minimal" || format === "jsonl") {
        console.log(formatJsonOutput(result));
        return;
      }

      // CSV format: flatten fields into rows
      if (format === "csv") {
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        const headers = ["fieldName", "fieldId", "dataType", "inherited", "origin"];
        const rows = fields.map((field) => [
          field.name,
          field.id,
          field.dataType || "",
          String(field.inherited),
          field.origin || "",
        ]);

        formatter.table(headers, rows);
        formatter.finalize();
        return;
      }

      // IDs format: output tag ID
      if (format === "ids") {
        console.log(tagId);
        return;
      }
    });
  });

  // tags inheritance <tagname>
  const inheritanceCmd = tags
    .command("inheritance <tagname>")
    .description("Show inheritance chain for a supertag")
    .option("--flat", "Show flattened list instead of tree");

  addStandardOptions(inheritanceCmd, { defaultLimit: "1" });

  inheritanceCmd.action(async (tagname: string, options: TagsMetadataOptions & { format?: OutputFormat; header?: boolean }) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const service = new SupertagMetadataService(ctx.db);

      // Resolve tag with duplicate warning
      const resolved = resolveTagWithDuplicateWarning(service, tagname, "inheritance");
      if (!resolved) {
        process.exit(1);
      }
      const { tagId, displayName } = resolved;

      const outputOpts = resolveOutputOptions(options);
      const format = resolveOutputFormat(options);

      // Get inheritance data
      const chain = service.getInheritanceChain(tagId);
      const ancestors = service.getAncestors(tagId);

      // Table format: use rich pretty output
      if (format === "table") {
        console.log(`\n🏷️  ${displayName} inheritance:\n`);
        if (options.flat) {
          // Flattened list of ancestors with depth
          if (ancestors.length === 0) {
            console.log("   (no parent supertags)");
          } else {
            for (const ancestor of ancestors) {
              // Use getTagName which falls back to nodes table for tagDefs without fields
              const name = service.getTagName(ancestor.tagId) || ancestor.tagId;
              console.log(`   ${"  ".repeat(ancestor.depth - 1)}↳ ${name} (depth: ${ancestor.depth})`);
            }
          }
        } else {
          // Tree view
          printInheritanceTree(chain, 0);
        }
        console.log();
        return;
      }

      // JSON formats: return chain structure
      if (format === "json" || format === "minimal" || format === "jsonl") {
        console.log(formatJsonOutput(chain));
        return;
      }

      // CSV format: flatten ancestors into rows
      if (format === "csv") {
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        const headers = ["tagId", "tagName", "depth"];
        const rows = ancestors.map((ancestor) => {
          const name = service.getTagName(ancestor.tagId) || ancestor.tagId;
          return [ancestor.tagId, name, String(ancestor.depth)];
        });

        formatter.table(headers, rows);
        formatter.finalize();
        return;
      }

      // IDs format: output ancestor IDs
      if (format === "ids") {
        for (const ancestor of ancestors) {
          console.log(ancestor.tagId);
        }
        return;
      }
    });
  });

  // tags fields <tagname>
  const fieldsCmd = tags
    .command("fields <tagname>")
    .description("Show fields for a supertag")
    .option("--all", "Show all fields including inherited")
    .option("--inherited", "Show only inherited fields")
    .option("--own", "Show only own fields (default without flags)");

  addStandardOptions(fieldsCmd, { defaultLimit: "100" });

  fieldsCmd.action(async (tagname: string, options: TagsMetadataOptions & { format?: OutputFormat; header?: boolean }) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    await withDatabase({ dbPath, readonly: true }, async (ctx) => {
      const service = new SupertagMetadataService(ctx.db);

      // Resolve tag with duplicate warning
      const resolved = resolveTagWithDuplicateWarning(service, tagname, "fields");
      if (!resolved) {
        process.exit(1);
      }
      const { tagId, displayName } = resolved;

      const outputOpts = resolveOutputOptions(options);
      const format = resolveOutputFormat(options);

      let fields: Array<{
        fieldName: string;
        fieldLabelId: string;
        originTagName: string;
        depth: number;
        inferredDataType?: string;
      }>;

      if (options.all) {
        // All fields including inherited
        fields = service.getAllFields(tagId).map(f => ({
          fieldName: f.fieldName,
          fieldLabelId: f.fieldLabelId,
          originTagName: f.originTagName,
          depth: f.depth,
          inferredDataType: f.inferredDataType,
        }));
      } else if (options.inherited) {
        // Only inherited fields (depth > 0)
        fields = service.getAllFields(tagId)
          .filter(f => f.depth > 0)
          .map(f => ({
            fieldName: f.fieldName,
            fieldLabelId: f.fieldLabelId,
            originTagName: f.originTagName,
            depth: f.depth,
            inferredDataType: f.inferredDataType,
          }));
      } else {
        // Default: own fields only (depth === 0)
        fields = service.getFields(tagId).map(f => ({
          fieldName: f.fieldName,
          fieldLabelId: f.fieldLabelId,
          originTagName: f.tagName,
          depth: 0,
          inferredDataType: f.inferredDataType,
        }));
      }

      // Build result data for all formats
      const result = { tagId, tagName: displayName, fields };

      // Table format: use rich pretty output
      if (format === "table") {
        const modeLabel = options.all ? "all" : options.inherited ? "inherited" : "own";
        console.log(`\n🏷️  ${displayName} (${tagId}) fields (${modeLabel}):\n`);
        if (fields.length === 0) {
          console.log("   (no fields)");
        } else {
          for (const field of fields) {
            const lines = formatFieldLines({
              name: field.fieldName,
              id: field.fieldLabelId,
              dataType: field.inferredDataType,
              origin: field.originTagName,
              inherited: field.depth > 0,
            });
            for (const line of lines) {
              console.log(line);
            }
          }
        }
        console.log();
        return;
      }

      // JSON formats: return full result
      if (format === "json" || format === "minimal" || format === "jsonl") {
        console.log(formatJsonOutput(result));
        return;
      }

      // CSV format: flatten fields into rows
      if (format === "csv") {
        const formatter = createFormatter({
          format,
          noHeader: options.header === false,
          humanDates: outputOpts.humanDates,
          verbose: outputOpts.verbose,
        });

        const headers = ["fieldName", "fieldLabelId", "dataType", "depth", "originTagName"];
        const rows = fields.map((field) => [
          field.fieldName,
          field.fieldLabelId,
          field.inferredDataType || "",
          String(field.depth),
          field.originTagName,
        ]);

        formatter.table(headers, rows);
        formatter.finalize();
        return;
      }

      // IDs format: output field label IDs
      if (format === "ids") {
        for (const field of fields) {
          console.log(field.fieldLabelId);
        }
        return;
      }
    });
  });

  // tags visualize
  const visualizeCmd = tags
    .command("visualize")
    .description("Visualize supertag inheritance graph")
    .option("--format <format>", "Output format (mermaid, dot, json, html, 3d)", "mermaid")
    .option("--root <tag>", "Root tag to start from (show descendants)")
    .option("--from <tag>", "Start tag to show ancestors (upwards)")
    .option("--depth <n>", "Maximum depth to traverse", parseInt)
    .option("--min-usage <n>", "Minimum usage count to include", parseInt)
    .option("--orphans", "Include orphan tags (no parents or children)")
    .option("--output <file>", "Write output to file instead of stdout")
    .option("--open", "Open output file after writing (requires --output)")
    .option("--direction <dir>", "Graph direction: BT, TB, LR, RL (default: BT)")
    .option("--show-fields", "Show field names and types in nodes (all formats)")
    .option("--show-inherited", "Include inherited fields (all formats, requires --show-fields)")
    .option("--colors", "Use tag colors in output (DOT and HTML format)")
    .option("--theme <theme>", "Color theme: light, dark (HTML and 3D format)", "light")
    .option("--layout <layout>", "3D layout: force, hierarchical (3D format only)", "force")
    .option("--size-by-usage", "Scale node size by usage count (3D format only)");

  // Note: includeFormat: false because visualize has its own --format for output format
  addStandardOptions(visualizeCmd, { defaultLimit: "1000", includeFormat: false });

  visualizeCmd.action(async (options: VisualizeOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    // Validate format before opening database
    const format = (options.format || "mermaid") as VisualizationFormat;
    if (!isFormatSupported(format)) {
      console.error(`❌ Unsupported format: ${format}`);
      console.error(`   Supported formats: ${supportedFormats.join(", ")}`);
      process.exit(1);
    }

    const output = await withDatabase({ dbPath, readonly: true }, (ctx) => {
      // Get visualization data
      const vizService = new VisualizationService(ctx.db);
      const vizOptions = {
        minUsageCount: options.minUsage,
        includeOrphans: options.orphans,
      };

      // Use getDataWithFields when --show-fields is used (all formats)
      let data;
      if (options.showFields) {
        if (options.root) {
          const subtree = vizService.getSubtreeWithFields(options.root, options.depth);
          if (!subtree) {
            console.error(`❌ Root tag not found: ${options.root}`);
            process.exit(1);
          }
          data = subtree;
        } else if (options.from) {
          const ancestors = vizService.getAncestorsWithFields(options.from, options.depth);
          if (!ancestors) {
            console.error(`❌ Tag not found: ${options.from}`);
            process.exit(1);
          }
          data = ancestors;
        } else {
          data = vizService.getDataWithFields(vizOptions);
        }
      } else {
        data = vizService.getData(vizOptions);
        // Filter to subtree if --root specified
        if (options.root) {
          const subtree = vizService.getSubtree(options.root, options.depth);
          if (!subtree) {
            console.error(`❌ Root tag not found: ${options.root}`);
            process.exit(1);
          }
          data = subtree;
        } else if (options.from) {
          const ancestors = vizService.getAncestors(options.from, options.depth);
          if (!ancestors) {
            console.error(`❌ Tag not found: ${options.from}`);
            process.exit(1);
          }
          data = ancestors;
        }
      }

      // Build format-specific render options
      const direction = options.direction || "BT";
      let renderOptions: MermaidRenderOptions | DOTRenderOptions | HTMLRenderOptions | ThreeRenderOptions;

      if (format === "mermaid") {
        renderOptions = {
          direction: direction as "BT" | "TB" | "LR" | "RL",
          showFields: options.showFields || false,
          showInheritedFields: options.showInherited || false,
        } as MermaidRenderOptions;
      } else if (format === "dot") {
        renderOptions = {
          rankdir: direction as "BT" | "TB" | "LR" | "RL",
          showFields: options.showFields || false,
          showInheritedFields: options.showInherited || false,
          useColors: options.colors || false,
        } as DOTRenderOptions;
      } else if (format === "html") {
        renderOptions = {
          direction: direction as "TB" | "BT" | "LR" | "RL",
          showFields: options.showFields || false,
          showInheritedFields: options.showInherited || false,
          theme: (options.theme === "dark" ? "dark" : "light") as "light" | "dark",
        } as HTMLRenderOptions;
      } else if (format === "3d") {
        renderOptions = {
          layout: (options.layout === "hierarchical" ? "hierarchical" : "force") as "force" | "hierarchical",
          theme: (options.theme === "dark" ? "dark" : "light") as "light" | "dark",
          showFields: options.showFields || false,
          showInheritedFields: options.showInherited || false,
          sizeByUsage: options.sizeByUsage || false,
        } as ThreeRenderOptions;
      } else {
        renderOptions = {};
      }

      // Render output
      return render(format, data, renderOptions);
    });

    // Write to file or stdout (outside withDatabase since file I/O doesn't need db)
    if (options.output) {
      writeFileSync(options.output, output);
      console.error(`✅ Output written to: ${options.output}`);

      if (options.open) {
        // Open file with default application
        const { spawn } = await import("child_process");
        spawn("open", [options.output], { detached: true, stdio: "ignore" }).unref();
      }
    } else {
      console.log(output);
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

/**
 * Format field details for display (shared between tags show and tags fields)
 *
 * @param field - Field with name, ID, and optional type
 * @param options - Display options
 * @returns Array of formatted lines to print
 */
export function formatFieldLines(
  field: {
    name: string;
    id: string;
    dataType?: string | null;
    origin?: string;
    inherited?: boolean;
  }
): string[] {
  const lines: string[] = [];

  // Build the main field line: "- Name (id)" or "- Name (id, from origin)"
  let mainLine = `   - ${field.name} (${field.id})`;
  if (field.inherited && field.origin) {
    mainLine = `   - ${field.name} (${field.id}, from ${field.origin})`;
  }
  lines.push(mainLine);

  // Add type on the next line if available
  if (field.dataType) {
    lines.push(`     Type: ${field.dataType}`);
  }

  return lines;
}
