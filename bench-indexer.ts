#!/usr/bin/env bun
/**
 * AutoResearch benchmark — measures sync index performance.
 * Fixed eval harness — DO NOT MODIFY during optimization.
 */
import { TanaIndexer } from "./src/db/indexer";
import { existsSync, copyFileSync, unlinkSync } from "fs";

const EXPORT = `${process.env.HOME}/Documents/Tana-Export/main/M9rkJkwuED@2026-03-16.json`;
const REAL_DB = `${process.env.HOME}/.local/share/supertag/workspaces/main/tana-index.db`;
const BENCH_DB = "/tmp/bench-indexer.db";

// Copy real DB for benchmarking (simulates incremental sync)
if (existsSync(REAL_DB)) {
  copyFileSync(REAL_DB, BENCH_DB);
  if (existsSync(REAL_DB + "-wal")) copyFileSync(REAL_DB + "-wal", BENCH_DB + "-wal");
  if (existsSync(REAL_DB + "-shm")) copyFileSync(REAL_DB + "-shm", BENCH_DB + "-shm");
}

const indexer = new TanaIndexer(BENCH_DB);
await indexer.initializeSchema();

const t0 = performance.now();
const result = await indexer.indexExport(EXPORT);
const t1 = performance.now();

indexer.close();

// Cleanup
try { unlinkSync(BENCH_DB); } catch {}
try { unlinkSync(BENCH_DB + "-wal"); } catch {}
try { unlinkSync(BENCH_DB + "-shm"); } catch {}

console.log("---");
console.log(`total_ms:          ${(t1 - t0).toFixed(0)}`);
console.log(`duration_ms:       ${result.durationMs}`);
console.log(`nodes_indexed:     ${result.nodesIndexed}`);
console.log(`nodes_added:       ${result.nodesAdded}`);
console.log(`nodes_modified:    ${result.nodesModified}`);
console.log(`nodes_deleted:     ${result.nodesDeleted}`);
console.log(`field_values:      ${result.fieldValuesIndexed}`);
console.log(`supertag_fields:   ${result.supertagFieldsExtracted}`);
