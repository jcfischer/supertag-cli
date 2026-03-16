#!/usr/bin/env bun
/**
 * Profiling benchmark — measures each phase of indexExport.
 */
import { TanaExportParser } from "./src/parsers/tana-export";
import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, unlinkSync } from "fs";

const EXPORT = `${process.env.HOME}/Documents/Tana-Export/main/M9rkJkwuED@2026-03-16.json`;
const REAL_DB = `${process.env.HOME}/.local/share/supertag/workspaces/main/tana-index.db`;
const BENCH_DB = "/tmp/bench-indexer-profile.db";

// Copy real DB
copyFileSync(REAL_DB, BENCH_DB);
if (existsSync(REAL_DB + "-wal")) copyFileSync(REAL_DB + "-wal", BENCH_DB + "-wal");
if (existsSync(REAL_DB + "-shm")) copyFileSync(REAL_DB + "-shm", BENCH_DB + "-shm");

const parser = new TanaExportParser();

// Phase 1: Parse
let t = performance.now();
const dump = await parser.parseFile(EXPORT);
const graph = parser.buildGraph(dump);
console.log(`Phase 1 - Parse + buildGraph: ${(performance.now()-t).toFixed(0)}ms`);

// Phase 2: Load existing checksums
const sqlite = new Database(BENCH_DB);
t = performance.now();
const results = sqlite.query("SELECT node_id, checksum FROM node_checksums").all() as any[];
const existingData = new Map(results.map((r: any) => [r.node_id, r.checksum]));
console.log(`Phase 2 - Load ${existingData.size} checksums: ${(performance.now()-t).toFixed(0)}ms`);

// Phase 3: Change detection (computeNodeChecksum for ALL nodes)
t = performance.now();
let added = 0, modified = 0;
const checksumCache = new Map<string, string>();
for (const [nodeId, node] of graph.nodes) {
  const criticalData = {
    name: node.props?.name || null,
    created: node.props?.created || null,
    modified: Array.isArray(node.modifiedTs) ? node.modifiedTs[0] : null,
    doneAt: node.props?._done || null,
    children: node.children || [],
    supertags: [],
  };
  const checksum = JSON.stringify(criticalData);
  checksumCache.set(nodeId, checksum);
  if (!existingData.has(nodeId)) added++;
  else if (existingData.get(nodeId) !== checksum) modified++;
}
console.log(`Phase 3 - Change detection (${graph.nodes.size} checksums): ${(performance.now()-t).toFixed(0)}ms  added=${added} modified=${modified}`);

// Phase 4: Build parent map
t = performance.now();
const parentMap = new Map<string, string>();
for (const [id, node] of graph.nodes) {
  if (node.children) {
    for (const childId of node.children) parentMap.set(childId, id);
  }
}
console.log(`Phase 4 - Build parent map: ${(performance.now()-t).toFixed(0)}ms`);

// Phase 5: Upsert ALL checksums (the current code does this for ALL nodes)
t = performance.now();
sqlite.run("BEGIN TRANSACTION");
const upsert = sqlite.prepare("INSERT OR REPLACE INTO node_checksums (node_id, checksum, last_seen) VALUES (?, ?, ?)");
const now = Date.now();
for (const [id, checksum] of checksumCache) {
  upsert.run(id, checksum, now);
}
sqlite.run("COMMIT");
console.log(`Phase 5 - Upsert ALL ${checksumCache.size} checksums: ${(performance.now()-t).toFixed(0)}ms`);

// Phase 6: Field values extraction
t = performance.now();
// Just measure how long extractFieldValuesFromNodes takes
const { extractFieldValuesFromNodes, insertFieldValues, clearFieldValues } = await import("./src/db/field-values");
const { clearSupertagMetadata, extractSupertagMetadata } = await import("./src/db/supertag-metadata");
import type { NodeDump } from "./src/types/tana-dump";

clearFieldValues(sqlite);
const fieldValues = extractFieldValuesFromNodes(graph.nodes as Map<string, NodeDump>, sqlite, { parentMap });
const getCreated = (pid: string) => graph.nodes.get(pid)?.props?.created ?? null;
insertFieldValues(sqlite, fieldValues, getCreated);
console.log(`Phase 6 - Field values (${fieldValues.length} values): ${(performance.now()-t).toFixed(0)}ms`);

// Phase 7: Supertag metadata
t = performance.now();
clearSupertagMetadata(sqlite);
const stMeta = extractSupertagMetadata(graph.nodes as Map<string, NodeDump>, sqlite);
console.log(`Phase 7 - Supertag metadata: ${(performance.now()-t).toFixed(0)}ms`);

// Phase 8: System fields + type extraction
t = performance.now();
const { discoverSystemFieldSources, insertSystemFieldSources } = await import("./src/db/system-fields");
const { extractFieldTypesFromDocs, updateFieldTypesFromExport, extractTargetSupertagsFromDocs, updateTargetSupertagsFromExport } = await import("./src/db/explicit-type-extraction");
const { updateFieldTypesFromValues } = await import("./src/db/value-type-inference");

const docsById = new Map(dump.docs.map(d => [d.id, d]));
const sfs = discoverSystemFieldSources(dump.docs, docsById);
insertSystemFieldSources(sqlite, sfs);
const explicitTypes = extractFieldTypesFromDocs(dump.docs);
updateFieldTypesFromExport(sqlite, explicitTypes);
const targetSupertags = extractTargetSupertagsFromDocs(dump.docs);
updateTargetSupertagsFromExport(sqlite, targetSupertags);
updateFieldTypesFromValues(sqlite);
console.log(`Phase 8 - System fields + types: ${(performance.now()-t).toFixed(0)}ms`);

sqlite.close();
try { unlinkSync(BENCH_DB); } catch {}
try { unlinkSync(BENCH_DB + "-wal"); } catch {}
try { unlinkSync(BENCH_DB + "-shm"); } catch {}
