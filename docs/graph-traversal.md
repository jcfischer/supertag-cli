# Graph Traversal (Related Nodes)

Find nodes related to a given node through references, children, and field links. Useful for exploring node connections, finding incoming citations, and discovering graph neighborhoods.

## Command Syntax

```bash
supertag related <nodeId> [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-d, --direction <dir>` | Traversal direction: in, out, or both (default: both) |
| `-t, --types <types>` | Relationship types to include (comma-separated) |
| `--depth <n>` | Maximum traversal depth 0-5 (default: 1) |
| `-l, --limit <n>` | Limit results (default: 50, max: 100) |
| `--format <type>` | Output format: table, json, csv, ids, minimal, jsonl |
| `--pretty` | Human-friendly table output |
| `--json` | JSON output |

## Relationship Types

| Type | Description |
|------|-------------|
| `child` | Node is a direct child of source |
| `parent` | Node is the parent of source |
| `reference` | Node is referenced via inline ref (`<span data-inlineref-node>`) |
| `field` | Node is connected through a field value |

Default: all types (`child,parent,reference,field`)

## Direction

| Direction | Description |
|-----------|-------------|
| `out` | Outgoing connections (source → target) |
| `in` | Incoming connections (target → source) |
| `both` | Both directions (default) |

## MCP Tool

The `tana_related` MCP tool provides the same functionality for AI assistants:

```json
{
  "nodeId": "abc123xyz",
  "direction": "both",
  "types": ["reference", "child"],
  "depth": 2,
  "limit": 20
}
```

---

## Examples

### Example 1: Find all related nodes (table format)

Find all nodes connected to a topic node:

```bash
supertag related abc123xyz --pretty
```

**Output:**
```
🔗 Related to: Security:

📥 Incoming (47):
  ← Discussion about cloud infrastructure and security team structure
     Type: reference
  ← Meeting notes mentioning security operations center setup
     Type: reference
  ← Project planning document for security reorganization
     Type: reference
  ← Notes about training for security awareness
     Type: reference
  ← Transcript discussing security incident response procedures
     Type: reference

Total: 47
```

---

### Example 2: Outgoing references only

Find what a node references (outgoing connections):

```bash
supertag related def456xyz --direction out --pretty
```

**Output:**
```
🔗 Related to: Meeting Transcript March 10:

📤 Outgoing (15):
  → MISP [topic]
     Type: reference
  → Azure [product]
     Type: reference
  → API [concept]
     Type: reference
  → Sentinel [product]
     Type: reference
  → Microsoft [organization]
     Type: reference

Total: 15
```

---

### Example 3: Incoming references only

Find what nodes reference a given topic:

```bash
supertag related abc123xyz --direction in --limit 5 --pretty
```

**Output:**
```
🔗 Related to: Security:

📥 Incoming (5):
  ← Notes about security team expansion plans
     Type: reference
  ← Meeting minutes from Q4 planning session
     Type: reference
  ← Discussion transcript about infrastructure
     Type: reference
  ← Project document mentioning security review
     Type: reference
  ← Summary of security operations analysis
     Type: reference

Total: 5
```

---

### Example 4: Multi-hop traversal

Find nodes within 2 hops of the source:

```bash
supertag related abc123xyz --depth 2 --limit 10 --pretty
```

**Output:**
```
🔗 Related to: Security:

📥 Incoming (10):
  ← Direct reference in meeting notes
     Type: reference
  ← Another direct reference in project doc
     Type: reference
  ← Connected via intermediate topic (2 hops)
     Type: reference (2 hops)
  ← Referenced through a person node (2 hops)
     Type: reference (2 hops)

Total: 10 (truncated)
```

---

### Example 5: Filter by relationship type

Find only reference-type connections (no child/parent):

```bash
supertag related abc123xyz --types reference --limit 5 --pretty
```

**Output:**
```
🔗 Related to: Topic Node:

📤 Outgoing (5):
  → JavaScript [topic]
     Type: reference
  → Updates [topic]
     Type: reference
  → API Documentation
     Type: reference
  → Azure [product]
     Type: reference
  → Sentinel [product]
     Type: reference

Total: 5
```

---

### Example 6: JSON output

Get related nodes as JSON for processing:

```bash
supertag related abc123xyz --direction in --limit 3 --json
```

**Output:**
```json
[
  {
    "id": "node123abc",
    "name": "Discussion about team structure and planning",
    "type": "reference",
    "direction": "in",
    "distance": "1",
    "tags": ""
  },
  {
    "id": "node456def",
    "name": "Meeting notes from quarterly review",
    "type": "reference",
    "direction": "in",
    "distance": "1",
    "tags": ""
  },
  {
    "id": "node789ghi",
    "name": "Project planning document",
    "type": "reference",
    "direction": "in",
    "distance": "1",
    "tags": "project"
  }
]
```

---

### Example 7: CSV output for spreadsheets

Export to CSV for analysis:

```bash
supertag related abc123xyz --direction in --limit 5 --format csv
```

**Output:**
```csv
id,name,type,direction,distance,tags
node123abc,"Discussion about team structure",reference,in,1,
node456def,"Meeting notes from quarterly review",reference,in,1,
node789ghi,"Project planning document",reference,in,1,project
node012jkl,"Summary of operations analysis",reference,in,1,
node345mno,"Notes about expansion plans",reference,in,1,
```

---

### Example 8: IDs only for batch processing

Get just the node IDs for piping to other commands:

```bash
supertag related abc123xyz --direction in --limit 5 --format ids
```

**Output:**
```
node123abc
node456def
node789ghi
node012jkl
node345mno
```

---

### Example 9: JSON Lines for streaming

Stream results for log processing:

```bash
supertag related abc123xyz --direction in --limit 3 --format jsonl
```

**Output:**
```jsonl
{"id":"node123abc","name":"Discussion about team structure","type":"reference","direction":"in","distance":"1","tags":""}
{"id":"node456def","name":"Meeting notes from review","type":"reference","direction":"in","distance":"1","tags":""}
{"id":"node789ghi","name":"Project planning document","type":"reference","direction":"in","distance":"1","tags":"project"}
```

---

## Use Cases

### Discover What References a Topic

```bash
# Find all nodes that mention "Security"
supertag related <security-topic-id> --direction in --limit 20 --pretty
```

### Find Outgoing Links from a Document

```bash
# What does this meeting transcript reference?
supertag related <transcript-id> --direction out --types reference --pretty
```

### Export Citation Graph

```bash
# Export all incoming references as CSV
supertag related <topic-id> --direction in --format csv > citations.csv
```

### Batch Process Related Nodes

```bash
# Get IDs and process each
supertag related <id> --format ids | xargs -I{} supertag nodes show {}
```

### Find Extended Network (2 hops)

```bash
# Discover nodes within 2 hops
supertag related <id> --depth 2 --limit 50 --pretty
```

### Filter to Specific Relationship Types

```bash
# Only child relationships
supertag related <id> --types child --pretty

# Only references (inline refs)
supertag related <id> --types reference --pretty

# References and fields
supertag related <id> --types reference,field --pretty
```

---

## Notes

- Maximum depth is 5 to prevent runaway traversals
- Maximum limit is 100 nodes per query
- Results are returned in BFS order (closest nodes first)
- Cycle detection prevents infinite loops in graph traversal
- Multi-hop results show the distance in the "(N hops)" suffix
- The source node is never included in results
- Empty results mean no connections of the specified type/direction exist
