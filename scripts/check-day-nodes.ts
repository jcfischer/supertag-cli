#!/usr/bin/env bun
/**
 * Check Recent Nodes in Tana Export
 *
 * Standalone script - no dependencies required except Bun runtime.
 * Parses a Tana JSON export file and shows the most recently created/edited nodes.
 *
 * Usage:
 *   bun check-day-nodes.ts <export-file.json> [--count N] [--days-only]
 *
 * Options:
 *   --count N    Show N most recent nodes (default: 20)
 *   --days-only  Only show Day nodes (original behavior)
 *
 * Example:
 *   bun check-day-nodes.ts ~/Documents/Tana-Export/main/M9rkJkwuED@2026-01-12.json
 *   bun check-day-nodes.ts ~/Documents/Tana-Export/main/M9rkJkwuED@2026-01-12.json --count 50
 *   bun check-day-nodes.ts ~/Documents/Tana-Export/main/M9rkJkwuED@2026-01-12.json --days-only
 *
 * What this diagnoses:
 *   Tana generates workspace snapshots periodically, NOT on-demand.
 *   When you export, you get the most recent snapshot which may be stale.
 *   If recent nodes are missing, the snapshot hasn't been updated yet.
 *
 * Installation:
 *   1. Install Bun: curl -fsSL https://bun.sh/install | bash
 *   2. Save this script as check-day-nodes.ts
 *   3. Run: bun check-day-nodes.ts <your-export-file.json>
 */

import { readFileSync, statSync } from "fs";
import { basename } from "path";

interface TanaNode {
  id: string;
  props: {
    name?: string;
    docType?: string;
    _ownerId?: string;
    created?: number;
    edited?: number;
  };
}

interface TanaExport {
  storeData?: {
    docs: TanaNode[];
    metadata?: {
      lastUpdated?: string;
    };
  };
  docs?: TanaNode[];
}

function parseExport(filePath: string): { nodes: TanaNode[]; lastUpdated?: string } {
  const content = readFileSync(filePath, "utf-8");
  const data: TanaExport = JSON.parse(content);

  // Handle both wrapped (storeData.docs) and unwrapped (docs) formats
  const nodes = data.storeData?.docs || data.docs || [];
  const lastUpdated = data.storeData?.metadata?.lastUpdated;

  return { nodes, lastUpdated };
}

function findDayNodes(nodes: TanaNode[]): TanaNode[] {
  // Day nodes use various formats depending on Tana locale settings

  const dayPatterns = [
    // "January 12, 2026" format (US)
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i,
    // "2026-01-12" format (ISO, exact)
    /^\d{4}-\d{2}-\d{2}$/,
    // "2026-01-12 - Monday" format (ISO with day name)
    /^\d{4}-\d{2}-\d{2}\s+-\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i,
    // "2026-01-12 - Montag" format (ISO with German day name)
    /^\d{4}-\d{2}-\d{2}\s+-\s+(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)$/i,
    // "12 January 2026" format (UK/EU)
    /^\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i,
    // "12. Januar 2026" format (German)
    /^\d{1,2}\.\s+(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+\d{4}$/i,
  ];

  return nodes.filter(node => {
    const name = node.props.name;
    if (!name) return false;
    return dayPatterns.some(pattern => pattern.test(name));
  });
}

function parseDateFromName(name: string): Date | null {
  // Try "January 12, 2026" format
  const monthDayYear = name.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/i);
  if (monthDayYear) {
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };
    return new Date(parseInt(monthDayYear[3]), months[monthDayYear[1].toLowerCase()], parseInt(monthDayYear[2]));
  }

  // Try "2026-01-12" or "2026-01-12 - Monday" format (extract just the date part)
  const isoDate = name.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return new Date(parseInt(isoDate[1]), parseInt(isoDate[2]) - 1, parseInt(isoDate[3]));
  }

  return null;
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "unknown";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function formatAge(ts: number | undefined): string {
  if (!ts) return "";
  const now = Date.now();
  const ageMs = now - ts;
  const ageMinutes = Math.floor(ageMs / (1000 * 60));
  const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${ageDays}d ago`;
}

function truncate(str: string, maxLen: number): string {
  if (!str) return "";
  // Remove newlines and collapse whitespace
  const clean = str.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + "...";
}

function showRecentNodes(nodes: TanaNode[], count: number): void {
  // Filter to nodes with created or edited timestamps and a name
  const withTimestamp = nodes.filter(n =>
    n.props.name &&
    (n.props.created || n.props.edited) &&
    n.props.docType !== "tuple" && // Skip tuple nodes (field structures)
    n.props.docType !== "metanode" && // Skip meta nodes
    !n.props.name.startsWith("1970-01-01T") // Skip timestamp artifact nodes
  );

  // Sort by most recent activity (edited > created)
  const sorted = withTimestamp.sort((a, b) => {
    const aTime = a.props.edited || a.props.created || 0;
    const bTime = b.props.edited || b.props.created || 0;
    return bTime - aTime;
  });

  console.log(`\n--- Most Recent ${count} Nodes (by activity) ---\n`);

  const recent = sorted.slice(0, count);
  for (const node of recent) {
    const edited = node.props.edited;
    const created = node.props.created;
    const timestamp = edited || created || 0;
    const timeType = edited ? "edited" : "created";
    const age = formatAge(timestamp);
    const docType = node.props.docType || "node";
    const name = truncate(node.props.name || "", 50);

    console.log(`  ${formatTimestamp(timestamp)} (${age.padEnd(8)}) [${docType.padEnd(10)}] ${name}`);
    console.log(`    id: ${node.id}`);
  }

  // Show stats
  console.log(`\n--- Activity Stats ---\n`);

  const last24h = withTimestamp.filter(n => {
    const t = n.props.edited || n.props.created || 0;
    return Date.now() - t < 24 * 60 * 60 * 1000;
  }).length;

  const last7d = withTimestamp.filter(n => {
    const t = n.props.edited || n.props.created || 0;
    return Date.now() - t < 7 * 24 * 60 * 60 * 1000;
  }).length;

  console.log(`  Nodes with activity in last 24h: ${last24h.toLocaleString()}`);
  console.log(`  Nodes with activity in last 7d:  ${last7d.toLocaleString()}`);
}

function showDayNodesAnalysis(nodes: TanaNode[]): void {
  const dayNodes = findDayNodes(nodes);
  console.log(`Day nodes found: ${dayNodes.length}`);

  if (dayNodes.length === 0) {
    console.log("\nNo day nodes found in export.");
    console.log("This could indicate the export is missing day nodes or uses a different naming format.");
    return;
  }

  // Sort by parsed date (most recent first)
  const sortedDays = dayNodes
    .map(node => ({
      node,
      date: parseDateFromName(node.props.name!),
      name: node.props.name!,
    }))
    .filter(d => d.date !== null)
    .sort((a, b) => b.date!.getTime() - a.date!.getTime());

  console.log("\n--- Most Recent 10 Day Nodes ---\n");

  const recent = sortedDays.slice(0, 10);
  for (const day of recent) {
    const created = day.node.props.created
      ? new Date(day.node.props.created).toISOString().slice(0, 10)
      : "unknown";
    console.log(`  ${day.name.padEnd(20)} (id: ${day.node.id}, created: ${created})`);
  }

  // Check for gaps in recent days
  console.log("\n--- Gap Analysis (last 14 days) ---\n");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existingDates = new Set(
    sortedDays
      .filter(d => d.date)
      .map(d => d.date!.toISOString().slice(0, 10))
  );

  const missingDays: string[] = [];
  for (let i = 0; i < 14; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = checkDate.toISOString().slice(0, 10);

    if (!existingDates.has(dateStr)) {
      missingDays.push(dateStr);
    }
  }

  if (missingDays.length === 0) {
    console.log("  All days present for the last 14 days.");
  } else {
    console.log(`  Missing days (${missingDays.length}):`);
    for (const day of missingDays) {
      console.log(`    - ${day}`);
    }
  }

  // Show oldest and newest
  if (sortedDays.length > 0) {
    console.log("\n--- Date Range ---\n");
    const oldest = sortedDays[sortedDays.length - 1];
    const newest = sortedDays[0];
    console.log(`  Oldest day: ${oldest.name}`);
    console.log(`  Newest day: ${newest.name}`);
  }
}

function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let filePath = "";
  let count = 20;
  let daysOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--days-only") {
      daysOnly = true;
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error("Usage: bun scripts/check-day-nodes.ts <export-file.json> [--count N] [--days-only]");
    console.error("\nOptions:");
    console.error("  --count N    Show N most recent nodes (default: 20)");
    console.error("  --days-only  Only show Day nodes (original behavior)");
    console.error("\nExample:");
    console.error("  bun scripts/check-day-nodes.ts ~/Documents/Tana-Export/main/M9rkJkwuED@2026-01-12.json");
    console.error("  bun scripts/check-day-nodes.ts ~/Documents/Tana-Export/main/M9rkJkwuED@2026-01-12.json --count 50");
    console.error("\nThis script checks if your Tana export contains recent nodes.");
    console.error("If recent nodes are missing, your Tana snapshot may be stale.");
    process.exit(1);
  }

  const modeLabel = daysOnly ? "Day Node Analysis" : "Recent Node Analysis";
  console.log(`\n=== Tana Export ${modeLabel} ===\n`);
  console.log(`File: ${basename(filePath)}`);

  try {
    // Show file modification time
    const stat = statSync(filePath);
    console.log(`File modified: ${stat.mtime.toISOString().replace("T", " ").slice(0, 19)}`);

    const { nodes, lastUpdated } = parseExport(filePath);
    console.log(`Total nodes: ${nodes.length.toLocaleString()}`);

    // Show snapshot timestamp if available
    if (lastUpdated) {
      const snapshotDate = new Date(lastUpdated);
      const now = new Date();
      const ageHours = Math.round((now.getTime() - snapshotDate.getTime()) / (1000 * 60 * 60));
      const ageDisplay = ageHours < 24 ? `${ageHours}h ago` : `${Math.round(ageHours / 24)}d ago`;
      console.log(`Snapshot timestamp: ${snapshotDate.toISOString().replace("T", " ").slice(0, 19)} (${ageDisplay})`);
      if (ageHours > 24) {
        console.log(`\n⚠️  WARNING: Snapshot is ${ageDisplay} old - may be missing recent changes!`);
      }
    }

    if (daysOnly) {
      showDayNodesAnalysis(nodes);
    } else {
      showRecentNodes(nodes, count);
      console.log("\n" + "=".repeat(50));
      showDayNodesAnalysis(nodes);
    }

  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
