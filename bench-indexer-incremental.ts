#!/usr/bin/env bun
/**
 * Benchmark incremental sync — simulates ~5000 changed nodes
 * by removing their checksums from a temporary DB copy.
 */
import { TanaIndexer } from "./src/db/indexer";
import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, unlinkSync } from "fs";

const EXPORT = `${process.env.HOME}/Documents/Tana-Export/main/M9rkJkwuED@2026-03-16.json`;
const REAL_DB = `${process.env.HOME}/.local/share/supertag/workspaces/main/tana-index.db`;
const BENCH_DB = "/tmp/bench-indexer-incr.db";

copyFileSync(REAL_DB, BENCH_DB);
if (existsSync(REAL_DB + "-wal")) copyFileSync(REAL_DB + "-wal", BENCH_DB + "-wal");
if (existsSync(REAL_DB + "-shm")) copyFileSync(REAL_DB + "-shm", BENCH_DB + "-shm");

// Simulate 5000 "new" nodes by removing their checksums from the temp copy
const simDb = new Database(BENCH_DB);
const removed = simDb.prepare("SELECT COUNT(*) as c FROM node_checksums").get() as any;
simDb.run("DELETE FROM node_checksums WHERE rowid IN (SELECT rowid FROM node_checksums LIMIT 5000)");
const after = simDb.prepare("SELECT COUNT(*) as c FROM node_checksums").get() as any;
console.log(`Simulated: removed ${removed.c - after.c} checksums to simulate new nodes`);
simDb.close();

const indexer = new TanaIndexer(BENCH_DB);
await indexer.initializeSchema();

const t0 = performance.now();
const result = await indexer.indexExport(EXPORT);
const t1 = performance.now();

indexer.close();

console.log("---");
console.log(`total_ms:          ${(t1 - t0).toFixed(0)}`);
console.log(`nodes_added:       ${result.nodesAdded}`);
console.log(`nodes_modified:    ${result.nodesModified}`);
console.log(`nodes_deleted:     ${result.nodesDeleted}`);
console.log(`field_values:      ${result.fieldValuesIndexed}`);

try { unlinkSync(BENCH_DB); } catch {}
try { unlinkSync(BENCH_DB + "-wal"); } catch {}
try { unlinkSync(BENCH_DB + "-shm"); } catch {}
