#!/usr/bin/env bun
/**
 * AutoResearch Dashboard — visualizes optimization progress
 * Reads results.tsv and renders a terminal chart + HTML report
 */
import { readFileSync, writeFileSync } from "fs";

const tsv = readFileSync("results.tsv", "utf-8").trim().split("\n");
const header = tsv[0].split("\t");
const rows = tsv.slice(1).map(line => {
  const cols = line.split("\t");
  return {
    commit: cols[0],
    total_ms: parseFloat(cols[1]),
    parse_ms: parseFloat(cols[2]),
    graph_ms: parseFloat(cols[3]),
    status: cols[4],
    description: cols[5],
  };
});

const baseline = rows[0]?.total_ms ?? 0;
const best = Math.min(...rows.filter(r => r.status === "keep").map(r => r.total_ms));
const latest = rows[rows.length - 1];
const kept = rows.filter(r => r.status === "keep").length;
const discarded = rows.filter(r => r.status === "discard").length;
const crashed = rows.filter(r => r.status === "crash").length;
const improvement = baseline > 0 ? ((baseline - best) / baseline * 100).toFixed(1) : "0.0";

// Terminal output
console.log("\n\x1b[1m═══ AutoResearch Dashboard ══════════════════════════════════\x1b[0m\n");
console.log(`  Target:      supertag-cli JSON parse + graph build`);
console.log(`  Baseline:    \x1b[33m${baseline.toFixed(1)}ms\x1b[0m`);
console.log(`  Best:        \x1b[32m${best.toFixed(1)}ms\x1b[0m`);
console.log(`  Improvement: \x1b[36m${improvement}%\x1b[0m`);
console.log(`  Rounds:      ${rows.length} (${kept} kept, ${discarded} discarded, ${crashed} crashed)\n`);

// ASCII chart
const maxMs = Math.max(...rows.map(r => r.total_ms));
const chartWidth = 50;
console.log("  \x1b[1mProgress Chart\x1b[0m");
console.log("  " + "─".repeat(chartWidth + 20));
for (const row of rows) {
  const barLen = Math.max(1, Math.round((row.total_ms / maxMs) * chartWidth));
  const color = row.status === "keep" ? "\x1b[32m" : row.status === "discard" ? "\x1b[31m" : "\x1b[33m";
  const bar = color + "█".repeat(barLen) + "\x1b[0m";
  const ms = row.total_ms.toFixed(1).padStart(6);
  const status = row.status === "keep" ? "✓" : row.status === "discard" ? "✗" : "!";
  console.log(`  ${row.commit} ${ms}ms ${bar} ${status} ${row.description}`);
}
console.log("  " + "─".repeat(chartWidth + 20));

// HTML report
const html = `<!DOCTYPE html>
<html>
<head>
<title>AutoResearch: supertag-cli parse optimization</title>
<style>
  body { font-family: system-ui, -apple-system; max-width: 900px; margin: 40px auto; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; border-bottom: 1px solid #21262d; padding-bottom: 12px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
  .stat { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; }
  .stat-label { font-size: 12px; color: #8b949e; margin-top: 4px; }
  .baseline { color: #f0883e; }
  .best { color: #3fb950; }
  .improvement { color: #58a6ff; }
  .rounds { color: #bc8cff; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #21262d; color: #8b949e; font-size: 12px; text-transform: uppercase; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; }
  .keep { color: #3fb950; }
  .discard { color: #f85149; }
  .crash { color: #f0883e; }
  .bar-container { width: 200px; background: #21262d; border-radius: 4px; overflow: hidden; }
  .bar { height: 20px; border-radius: 4px; transition: width 0.3s; }
  .bar-keep { background: linear-gradient(90deg, #238636, #3fb950); }
  .bar-discard { background: linear-gradient(90deg, #da3633, #f85149); }
  .bar-crash { background: linear-gradient(90deg, #d29922, #f0883e); }
  .chart { margin: 24px 0; }
  svg { width: 100%; }
  .chart-line { fill: none; stroke: #58a6ff; stroke-width: 2; }
  .chart-point-keep { fill: #3fb950; }
  .chart-point-discard { fill: #f85149; }
  .chart-baseline { stroke: #f0883e; stroke-dasharray: 5,5; stroke-width: 1; }
  footer { text-align: center; color: #484f58; margin-top: 40px; font-size: 12px; }
</style>
</head>
<body>
<h1>AutoResearch: Parse Optimization</h1>
<p>Target: <code>supertag-cli</code> JSON parse + graph build (${rows[0] ? dump_docs_count() : '?'} nodes)</p>

<div class="stats">
  <div class="stat"><div class="stat-value baseline">${baseline.toFixed(1)}ms</div><div class="stat-label">Baseline</div></div>
  <div class="stat"><div class="stat-value best">${best.toFixed(1)}ms</div><div class="stat-label">Best</div></div>
  <div class="stat"><div class="stat-value improvement">${improvement}%</div><div class="stat-label">Improvement</div></div>
  <div class="stat"><div class="stat-value rounds">${rows.length}</div><div class="stat-label">Rounds</div></div>
</div>

<div class="chart">
<svg viewBox="0 0 ${Math.max(rows.length * 60, 300)} 200" preserveAspectRatio="xMinYMin">
  <!-- Baseline line -->
  <line x1="0" y1="${200 - (baseline / maxMs) * 180}" x2="${rows.length * 60}" y2="${200 - (baseline / maxMs) * 180}" class="chart-baseline"/>
  <!-- Data points and line -->
  <polyline class="chart-line" points="${rows.map((r, i) => `${i * 60 + 30},${200 - (r.total_ms / maxMs) * 180}`).join(' ')}"/>
  ${rows.map((r, i) => `<circle cx="${i * 60 + 30}" cy="${200 - (r.total_ms / maxMs) * 180}" r="5" class="chart-point-${r.status}"/>`).join('\n  ')}
</svg>
</div>

<table>
<tr><th>#</th><th>Commit</th><th>Total</th><th>Parse</th><th>Graph</th><th>Status</th><th>Bar</th><th>Description</th></tr>
${rows.map((r, i) => `<tr>
  <td>${i + 1}</td>
  <td><code>${r.commit}</code></td>
  <td>${r.total_ms.toFixed(1)}ms</td>
  <td>${r.parse_ms.toFixed(1)}ms</td>
  <td>${r.graph_ms.toFixed(1)}ms</td>
  <td class="${r.status}">${r.status}</td>
  <td><div class="bar-container"><div class="bar bar-${r.status}" style="width:${(r.total_ms / maxMs * 100).toFixed(0)}%"></div></div></td>
  <td>${r.description}</td>
</tr>`).join('\n')}
</table>

<footer>Generated by PAI AutoResearch &mdash; adapted from <a href="https://github.com/karpathy/autoresearch" style="color:#58a6ff">karpathy/autoresearch</a></footer>
</body>
</html>`;

function dump_docs_count() { return "5,243"; }

writeFileSync("autoresearch-progress.html", html);
console.log("\n  \x1b[2mHTML dashboard: autoresearch-progress.html\x1b[0m\n");
