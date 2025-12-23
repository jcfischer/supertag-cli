# Field Values Documentation

Query and search structured field data from Tana nodes. This feature extracts text values from Tana's tuple structures, making them searchable and queryable.

## Background

In Tana, fields like "Summary", "Action Items", or custom fields store their values in a special tuple structure:

```
Node (e.g., Meeting Notes)
└── Tuple (_docType: "tuple", _sourceId: field definition)
    ├── Field Label ("Summary")
    └── Value Node ("Key discussion points covered...")
```

Supertag CLI indexes these values into a dedicated `field_values` table with full-text search (FTS5), enabling:

- **Discovery**: List all fields in your workspace
- **Querying**: Get all values for a specific field
- **Searching**: Full-text search across field values
- **Filtering**: Filter by date ranges and specific fields

## CLI Commands

### List All Fields

```bash
# List all field names with usage counts
supertag fields list

# Output (pretty mode):
#  📜 Field Names (31 of 31)
#
#   #  Field Name           Values
#  ───────────────────────────────────
#   1  Summary                  1,234
#   2  Action Items               856
#   3  Gestern war gut weil       521
#   4  Notes                      412
#   5  Status                     389
#
#  💡 Use 'fields values <name>' to see values for a field

# JSON output
supertag fields list --json

# Limit results
supertag fields list --limit 10
```

### Get Field Values

```bash
# Get values for a specific field
supertag fields values "Summary"

# Output (pretty mode):
#  📄 Field: Summary (100 values)
#
#  • Key discussion points from quarterly review meeting
#  • Project timeline adjusted to accommodate new requirements
#  • Authentication module completed and ready for testing
#  ...

# With pagination
supertag fields values "Summary" --limit 20 --offset 40

# Filter by date
supertag fields values "Summary" --after 2025-01-01 --before 2025-12-31

# Verbose mode (shows parent ID and date)
supertag fields values "Summary" --verbose

# JSON output
supertag fields values "Summary" --json
```

### Search Field Values

```bash
# Full-text search across all field values
supertag fields search "meeting notes"

# Output (pretty mode):
#  🔍 Search: "meeting notes" (15 results)
#
#  [Summary]
#  Meeting notes from sprint planning session
#  Parent: abc123
#
#  [Action Items]
#  Review meeting notes and extract action items
#  Parent: def456
#  ...

# Search within a specific field only
supertag fields search "project" --field "Summary"

# Limit results
supertag fields search "authentication" --limit 20

# Verbose mode
supertag fields search "sprint" --verbose

# JSON output for scripting
supertag fields search "budget" --json
```

## MCP Tool: tana_field_values

The MCP server exposes field values through the `tana_field_values` tool with three modes.

### Mode: list

List all available field names with usage counts.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | Yes | Must be "list" |
| `workspace` | string | No | Workspace alias (default: main) |
| `limit` | number | No | Max results (default: 100) |

**Example prompt:**
```
What fields are available in my Tana workspace?
```

**Response:**
```json
{
  "workspace": "main",
  "mode": "list",
  "fields": [
    { "fieldName": "Summary", "count": 1234 },
    { "fieldName": "Action Items", "count": 856 },
    { "fieldName": "Gestern war gut weil", "count": 521 }
  ],
  "count": 31
}
```

### Mode: query

Get all values for a specific field.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | Yes | Must be "query" |
| `fieldName` | string | Yes | Field name to query |
| `workspace` | string | No | Workspace alias |
| `limit` | number | No | Max results (default: 100) |
| `offset` | number | No | Skip N results (pagination) |
| `createdAfter` | string | No | ISO date filter (YYYY-MM-DD) |
| `createdBefore` | string | No | ISO date filter |

**Example prompts:**
```
Show me all my "Gestern war gut weil" entries from December
What summaries have I written this month?
List my recent action items
```

**Response:**
```json
{
  "workspace": "main",
  "mode": "query",
  "results": [
    {
      "parentId": "abc123",
      "parentName": "Daily Reflection 2025-12-23",
      "fieldName": "Gestern war gut weil",
      "valueText": "Productive coding session, fixed the performance bug",
      "created": 1734912000000
    }
  ],
  "count": 1
}
```

### Mode: search

Full-text search across all field values.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | Yes | Must be "search" |
| `query` | string | Yes | Search query |
| `fieldName` | string | No | Limit to specific field |
| `workspace` | string | No | Workspace alias |
| `limit` | number | No | Max results (default: 50) |

**Example prompts:**
```
Search my field values for "sprint planning"
Find summaries mentioning "authentication"
Search my action items for "review"
```

**Response:**
```json
{
  "workspace": "main",
  "mode": "search",
  "results": [
    {
      "parentId": "xyz789",
      "parentName": "Sprint 42 Planning",
      "fieldName": "Summary",
      "valueText": "Sprint planning for Q1 authentication features"
    }
  ],
  "count": 1
}
```

## Use Cases

### Daily Journaling

If you use fields like "Gestern war gut weil" (German: "Yesterday was good because") or "Gratitude" for daily reflections:

```bash
# Review all gratitude entries
supertag fields values "Gratitude" --limit 30

# Search for specific themes
supertag fields search "family" --field "Gratitude"

# Export for review
supertag fields values "Gestern war gut weil" --json > reflections.json
```

### Meeting Management

For meetings with "Summary" and "Action Items" fields:

```bash
# Find all meeting summaries mentioning a project
supertag fields search "Project Alpha" --field "Summary"

# Get recent action items
supertag fields values "Action Items" --after 2025-12-01

# Export action items for processing
supertag fields values "Action Items" --json | jq '.[] | .valueText'
```

### Project Documentation

For nodes with "Notes", "Requirements", or "Status" fields:

```bash
# Search all notes for technical terms
supertag fields search "API endpoint"

# Get all status updates
supertag fields values "Status" --limit 50

# Find requirements mentioning security
supertag fields search "security" --field "Requirements"
```

### Scripting and Automation

```bash
# Count entries per field
supertag fields list --json | jq '.[] | "\(.fieldName): \(.count)"'

# Export specific field for analysis
supertag fields values "Summary" --json > summaries.json

# Search and process results
supertag fields search "urgent" --json | jq '.[] | .parentId'

# Pipe to other tools
supertag fields values "Action Items" | grep -i "review"
```

## Output Formats

### Unix Mode (Default)

Tab-separated values, ideal for piping:

```bash
supertag fields list
# Summary\t1234
# Action Items\t856

supertag fields values "Summary"
# Key discussion points from quarterly review meeting
# Project timeline adjusted to accommodate new requirements

supertag fields search "meeting"
# Summary\tMeeting notes from sprint planning session
# Action Items\tReview meeting notes and extract action items
```

### Pretty Mode

Human-readable with formatting:

```bash
supertag fields list --pretty
supertag fields values "Summary" --pretty
supertag fields search "meeting" --pretty
```

### JSON Mode

Structured data for scripting:

```bash
supertag fields list --json
supertag fields values "Summary" --json
supertag fields search "meeting" --json
```

### Verbose Mode

Adds technical details (parent IDs, timestamps):

```bash
supertag fields values "Summary" --verbose
# abc123\t1734912000000\tKey discussion points...

supertag fields search "meeting" --verbose
# abc123\tSummary\tMeeting notes from sprint planning
```

## Integration with Embeddings

Field values can be included in embedding generation to improve semantic search:

```bash
# Generate embeddings with field context
supertag embed generate --include-fields
```

This adds field values to the node's text context, enabling semantic search to find nodes based on their field content.

## Performance

| Operation | Performance |
|-----------|-------------|
| Field list | < 10ms |
| Field query | < 50ms |
| FTS search | < 50ms |
| Index 44k tuples | ~30 seconds |

The field values table uses FTS5 full-text indexing for fast search performance.

## Troubleshooting

### "No fields found"

Ensure you've indexed after a recent export:

```bash
supertag sync index
```

### "Field name not found"

Check available field names:

```bash
supertag fields list
```

Field names are case-sensitive. Use the exact name from the list.

### Empty results

Field values are extracted from tuple structures. If a field has no values:

1. The field may be defined but unused
2. The field may use non-text values (references, dates)
3. The export may be outdated - run a new export

### Performance issues

If indexing is slow, this is normal for large workspaces. The indexer uses optimized O(1) parent lookups for field extraction.

## Related Documentation

- [Embeddings](./embeddings.md) - Semantic search with field context
- [MCP Integration](./mcp.md) - AI tool setup
- [Workspaces](./workspaces.md) - Multi-workspace queries
