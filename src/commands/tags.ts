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
import { SchemaRegistry } from "../schema/registry";
import { getConfig } from "../config/manager";
import { resolveWorkspace } from "../config/paths";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
} from "./helpers";
import type { StandardOptions } from "../types";

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

    try {
      const topTags = await engine.getTopTagsByUsage(limit);

      if (options.json) {
        console.log(formatJsonOutput(topTags));
      } else {
        console.log(`\n🏷️  Top ${topTags.length} supertags by usage:\n`);
        topTags.forEach((tag, i) => {
          console.log(`${i + 1}. #${tag.tagName} (${tag.count} nodes)`);
        });
        console.log();
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
    const config = getConfig().getConfig();
    const ctx = resolveWorkspace(options.workspace, config);

    // Load schema registry
    const registry = new SchemaRegistry(ctx.schemaPath);
    await registry.load();

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

  return tags;
}
