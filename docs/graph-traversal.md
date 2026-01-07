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
  "nodeId": "mMHt6NjbI9sH",
  "direction": "both",
  "types": ["reference", "field"],
  "depth": 2,
  "limit": 20
}
```

---

## Examples

### Example 1: Find all related nodes (table format)

Find all nodes connected to a topic node:

```bash
supertag related mMHt6NjbI9sH --pretty
```

**Output:**
```
🔗 Related to: Tana:

📤 Outgoing (1):
  → Gather Stream Storage [Vault]
     Type: field

📥 Incoming (8):
  ← Tana (merged into main topic)
     Type: reference
  ← Try the summary tool again for meeting summaries [todo]
     Type: reference
  ← Send information about Tana to contact [todo]
     Type: reference
  ← The Workflowy Timeline [resource, toread]
     Type: field
  ← CLI todo name
     Type: field

Total: 9
```

---

### Example 2: Outgoing references only

Find what a node references (outgoing connections):

```bash
supertag related epQm19hntCYm --direction out --pretty
```

**Output:**
```
🔗 Related to: Tana Input API:

📤 Outgoing (1):
  → Gather Stream Storage [Vault]
     Type: field

Total: 1
```

---

### Example 3: Incoming references only

Find what nodes reference a given topic:

```bash
supertag related mMHt6NjbI9sH --direction in --limit 5 --pretty
```

**Output:**
```
🔗 Related to: Tana:

📥 Incoming (5):
  ← Tana (merged into main topic)
     Type: reference
  ← Try the summary tool again for meeting summaries [todo]
     Type: reference
  ← Send information about Tana to contact [todo]
     Type: reference
  ← The Workflowy Timeline [resource, toread]
     Type: field
  ← CLI todo name
     Type: field

Total: 5
```

---

### Example 4: Multi-hop traversal

Find nodes within 2 hops of the source:

```bash
supertag related mMHt6NjbI9sH --depth 2 --limit 10 --pretty
```

**Output:**
```
🔗 Related to: Tana:

📤 Outgoing (2):
  → Gather Stream Storage [Vault]
     Type: field
  → Vault Library
     Type: field (2 hops)

📥 Incoming (8):
  ← Tana (merged into main topic)
     Type: reference
  ← Try the summary tool again for meeting summaries [todo]
     Type: reference
  ← Send information about Tana to contact [todo]
     Type: reference
  ← The Workflowy Timeline [resource, toread]
     Type: field
  ← CLI todo name
     Type: field

Total: 10 (truncated)
```

---

### Example 5: Filter by relationship type

Find only reference-type connections (no field/child/parent):

```bash
supertag related mMHt6NjbI9sH --types reference --limit 5 --pretty
```

**Output:**
```
🔗 Related to: Tana:

📥 Incoming (3):
  ← Tana (merged into main topic)
     Type: reference
  ← Try the summary tool again for meeting summaries [todo]
     Type: reference
  ← Send information about Tana to contact [todo]
     Type: reference

Total: 3
```

---

### Example 6: JSON output

Get related nodes as JSON for processing:

```bash
supertag related mMHt6NjbI9sH --direction in --limit 3 --json
```

**Output:**
```json
[
  {
    "id": "0fRqAhVFb_W4",
    "name": "Tana (merged into main topic)",
    "type": "reference",
    "direction": "in",
    "distance": "1",
    "tags": ""
  },
  {
    "id": "FLiUiuqD0i4D",
    "name": "Try the summary tool again for meeting summaries",
    "type": "reference",
    "direction": "in",
    "distance": "1",
    "tags": "todo"
  },
  {
    "id": "x7bVqUUemYpX",
    "name": "Send information about Tana to contact",
    "type": "reference",
    "direction": "in",
    "distance": "1",
    "tags": "todo"
  }
]
```

---

### Example 7: CSV output for spreadsheets

Export to CSV for analysis:

```bash
supertag related mMHt6NjbI9sH --direction in --limit 5 --format csv
```

**Output:**
```csv
id,name,type,direction,distance,tags
0fRqAhVFb_W4,"Tana (merged into main topic)",reference,in,1,
FLiUiuqD0i4D,"Try the summary tool again for meeting summaries",reference,in,1,todo
x7bVqUUemYpX,"Send information about Tana to contact",reference,in,1,todo
KjL2mPqR3nVw,"The Workflowy Timeline",field,in,1,"resource,toread"
QrS4tUvW5xYz,"CLI todo name",field,in,1,
```

---

### Example 8: IDs only for batch processing

Get just the node IDs for piping to other commands:

```bash
supertag related mMHt6NjbI9sH --direction in --limit 5 --format ids
```

**Output:**
```
0fRqAhVFb_W4
FLiUiuqD0i4D
x7bVqUUemYpX
KjL2mPqR3nVw
QrS4tUvW5xYz
```

---

### Example 9: JSON Lines for streaming

Stream results for log processing:

```bash
supertag related mMHt6NjbI9sH --direction in --limit 3 --format jsonl
```

**Output:**
```jsonl
{"id":"0fRqAhVFb_W4","name":"Tana (merged into main topic)","type":"reference","direction":"in","distance":"1","tags":""}
{"id":"FLiUiuqD0i4D","name":"Try the summary tool again for meeting summaries","type":"reference","direction":"in","distance":"1","tags":"todo"}
{"id":"x7bVqUUemYpX","name":"Send information about Tana to contact","type":"reference","direction":"in","distance":"1","tags":"project"}
```

---

## Use Cases

### Discover What References a Topic

```bash
# First, find the topic ID
supertag search "Security" --tag topic --format ids --limit 1

# Then find all nodes that reference it
supertag related LVKnyxTeX6ej --direction in --limit 20 --pretty
```

### Find Outgoing Links from a Document

```bash
# What does this meeting transcript reference?
supertag related mMHt6NjbI9sH --direction out --types reference --pretty
```

### Export Citation Graph

```bash
# Export all incoming references as CSV
supertag related mMHt6NjbI9sH --direction in --format csv > citations.csv
```

### Batch Process Related Nodes

```bash
# Get IDs and process each
supertag related mMHt6NjbI9sH --format ids | xargs -I{} supertag nodes show {}
```

### Find Extended Network (2 hops)

```bash
# Discover nodes within 2 hops
supertag related mMHt6NjbI9sH --depth 2 --limit 50 --pretty
```

### Filter to Specific Relationship Types

```bash
# Only child relationships
supertag related mMHt6NjbI9sH --types child --pretty

# Only references (inline refs)
supertag related mMHt6NjbI9sH --types reference --pretty

# References and fields
supertag related mMHt6NjbI9sH --types reference,field --pretty
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
