#!/usr/bin/env bun
/**
 * AutoResearch benchmark — measures parse + graph build performance.
 * This is the "prepare.py" equivalent — the fixed eval harness.
 * DO NOT MODIFY during optimization.
 */
import { TanaExportParser } from "./src/parsers/tana-export";

// Use real 360MB export for realistic benchmarking, fall back to fixture
const REAL_EXPORT = `${process.env.HOME}/Documents/Tana-Export/main/M9rkJkwuED@2026-03-16.json`;
const FIXTURE = "./tests/fixtures/sample-workspace.json";

import { existsSync } from "fs";
const filePath = existsSync(REAL_EXPORT) ? REAL_EXPORT : FIXTURE;
const RUNS = 3; // Fewer runs for large files

const parser = new TanaExportParser();
const results: { parse: number; graph: number; total: number }[] = [];

for (let i = 0; i < RUNS; i++) {
  const t0 = performance.now();
  const dump = await parser.parseFile(filePath);
  const t1 = performance.now();
  const graph = parser.buildGraph(dump);
  const t2 = performance.now();
  results.push({ parse: t1 - t0, graph: t2 - t1, total: t2 - t0 });

  if (i === 0) {
    console.log(`file: ${filePath.split("/").pop()}`);
    console.log(`file_size_mb: ${(Bun.file(filePath).size / 1024 / 1024).toFixed(1)}`);
    console.log(`nodes: ${dump.docs.length}`);
    console.log(`supertags: ${graph.supertags.size}`);
    console.log(`fields: ${graph.fields.size}`);
    console.log(`tag_applications: ${graph.tagApplications.length}`);
  }
}

// Use median
const sorted = results.sort((a, b) => a.total - b.total);
const median = sorted[Math.floor(sorted.length / 2)];

console.log("---");
console.log(`parse_ms:          ${median.parse.toFixed(1)}`);
console.log(`graph_ms:          ${median.graph.toFixed(1)}`);
console.log(`total_ms:          ${median.total.toFixed(1)}`);
