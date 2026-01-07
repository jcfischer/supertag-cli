# Aggregation Queries

Group and count Tana nodes by field values or time periods. Useful for analytics, status breakdowns, and time-series analysis.

## Command Syntax

```bash
supertag aggregate --tag <tagname> --group-by <fields> [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--tag <tagname>` | Supertag to aggregate (required) |
| `--group-by <fields>` | Field(s) to group by, comma-separated (required) |
| `--show-percent` | Show percentage of total alongside counts |
| `--top <n>` | Return only top N groups by count |
| `--limit <n>` | Limit total results (default: 10) |
| `--format <type>` | Output format: table, json, csv, jsonl |
| `--pretty` | Human-friendly table output |
| `--json` | JSON output |

## Time Periods

When grouping by time, use these period names:

| Period | Format | Example |
|--------|--------|---------|
| `day` | YYYY-MM-DD | 2025-01-07 |
| `week` | YYYY-WNN | 2025-W01 |
| `month` | YYYY-MM | 2025-01 |
| `quarter` | YYYY-QN | 2025-Q1 |
| `year` | YYYY | 2025 |

## MCP Tool

The `tana_aggregate` MCP tool provides the same functionality for AI assistants:

```json
{
  "find": "task",
  "groupBy": ["Status"],
  "showPercent": true,
  "top": 10
}
```

---

## Examples

### Example 1: Count todos by Status

Group todos by their Status field value:

```bash
supertag aggregate --tag todo --group-by Status
```

**Output:**
```json
{
  "total": 970,
  "groupCount": 5,
  "groups": {
    "(none)": 964,
    "Available": 2,
    "Done": 2,
    "In Progress": 1,
    "In Progress": 1
  }
}
```

---

### Example 2: Count meetings by month (table format)

Time-based grouping with human-readable table output:

```bash
supertag aggregate --tag meeting --group-by month --pretty
```

**Output:**
```
Aggregation Results

   month      Count
   ────────────────────────────────────────
   2025-10    151
   2025-06    151
   2024-06    131
   2025-12    127
   2024-11    126
   2025-03    125
   2024-12    125
   2025-11    119
   2025-09    116
   2024-08    113
   ────────────────────────────────────────
   Total: 2,279 nodes in 10 groups

   Warning: Results capped at 10 groups
```

---

### Example 3: Count meetings by month with percentages

Add percentage column to see distribution:

```bash
supertag aggregate --tag meeting --group-by month --show-percent --pretty --limit 8
```

**Output:**
```
Aggregation Results

   month      Count   Percent
   ────────────────────────────────────────
   2025-10    151     7%
   2025-06    151     7%
   2024-06    131     6%
   2025-12    127     6%
   2024-11    126     6%
   2025-03    125     5%
   2024-12    125     5%
   2025-11    119     5%
   ────────────────────────────────────────
   Total: 2,279 nodes in 8 groups

   Warning: Results capped at 8 groups
```

---

### Example 4: Top 5 busiest quarters for meetings

Use `--top` to get only the highest counts:

```bash
supertag aggregate --tag meeting --group-by quarter --top 5 --pretty
```

**Output:**
```
Aggregation Results

   quarter    Count
   ────────────────────────────────────────
   2025-Q4    397
   2025-Q2    348
   2024-Q4    343
   2024-Q3    325
   2025-Q3    283
   ────────────────────────────────────────
   Total: 2,279 nodes in 5 groups

   Warning: Results capped at 5 groups
```

---

### Example 5: Meetings by year (CSV format)

Export to CSV for spreadsheets:

```bash
supertag aggregate --tag meeting --group-by year --format csv
```

**Output:**
```csv
year,count
"2024",1007
"2025",1266
"2026",6
```

---

### Example 6: Projects by Status field

Group by a custom field with emoji values:

```bash
supertag aggregate --tag project --group-by Status --pretty --show-percent
```

**Output:**
```
Aggregation Results

   Status           Count   Percent
   ────────────────────────────────────────
   (none)           29      56%
   Complete         12      23%
   Ongoing          9       17%
   Abandoned        2       4%
   ────────────────────────────────────────
   Total: 52 nodes in 4 groups
```

---

### Example 7: Two-dimensional grouping

Group by two dimensions for nested analysis (Status x year):

```bash
supertag aggregate --tag project --group-by Status,year --pretty
```

**Output:**
```
Aggregation Results

   Status → year

   (none):
      2024:      9
      2025:     19
      2026:      1

   Complete:
      2023:      1
      2024:     10
      2025:      1

   Abandoned:
      2024:      2

   Ongoing:
      2023:      1
      2024:      7
      2025:      1

   Total: 52 nodes in 4 groups
```

---

### Example 8: JSON Lines format for streaming

Use JSONL for log processing or streaming pipelines:

```bash
supertag aggregate --tag project --group-by Status --format jsonl
```

**Output:**
```jsonl
{"group":"(none)","count":29}
{"group":"Complete","count":12}
{"group":"Ongoing","count":9}
{"group":"Abandoned","count":2}
```

---

### Example 9: Full JSON with percentages

Complete JSON response including percentages:

```bash
supertag aggregate --tag project --group-by Status --show-percent --json
```

**Output:**
```json
{
  "total": 52,
  "groupCount": 4,
  "groups": {
    "(none)": 29,
    "Complete": 12,
    "Ongoing": 9,
    "Abandoned": 2
  },
  "percentages": {
    "(none)": 56,
    "Complete": 23,
    "Ongoing": 17,
    "Abandoned": 4
  }
}
```

---

### Example 10: Meetings per week

Weekly aggregation to find busiest weeks:

```bash
supertag aggregate --tag meeting --group-by week --top 10 --pretty
```

**Output:**
```
Aggregation Results

   week       Count
   ────────────────────────────────────────
   2025-W24   67
   2024-W27   44
   2024-W25   44
   2025-W26   42
   2024-W49   42
   2024-W50   40
   2025-W50   38
   2025-W41   37
   2024-W33   37
   2024-W23   37
   ────────────────────────────────────────
   Total: 2,279 nodes in 10 groups

   Warning: Results capped at 10 groups
```

---

### Example 11: Articles by day

Daily aggregation to see content creation patterns:

```bash
supertag aggregate --tag article --group-by day --top 5 --pretty
```

**Output:**
```
Aggregation Results

   day          Count
   ────────────────────────────────────────
   2024-04-23   5
   2023-10-15   5
   2024-01-02   2
   2025-06-15   1
   2024-12-30   1
   ────────────────────────────────────────
   Total: 23 nodes in 5 groups

   Warning: Results capped at 5 groups
```

---

## Use Cases

### Status Breakdown
```bash
# What's the status of my tasks?
supertag aggregate --tag task --group-by Status --show-percent --pretty
```

### Activity Timeline
```bash
# When was I most active?
supertag aggregate --tag meeting --group-by month --top 12 --pretty
```

### Project Analytics
```bash
# Project completion by year
supertag aggregate --tag project --group-by Status,year --pretty
```

### Export for Reporting
```bash
# Export to CSV for spreadsheet analysis
supertag aggregate --tag todo --group-by Status --format csv > todo-status.csv
```

### Streaming to Other Tools
```bash
# Pipe to jq for further processing
supertag aggregate --tag meeting --group-by month --format jsonl | jq 'select(.count > 100)'
```

---

## Notes

- Nodes without a value for the grouped field appear as `(none)`
- Results are sorted by count (descending) by default
- Use `--limit` to control the maximum number of groups returned
- Use `--top` to get only the N highest counts
- Two-dimensional grouping supports up to 2 fields
- Time-based grouping uses the node's `created` timestamp
