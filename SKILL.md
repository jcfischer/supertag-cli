# Supertag CLI Skill

---
name: supertag
description: Complete Tana integration via MCP. USE WHEN user mentions Tana, tana search, tana notes, my notes, my knowledge base, find in Tana, create in Tana, OR needs to search, query, or write to Tana workspace. Provides full-text search, semantic search, node creation, and workspace management.
---

## Overview

Supertag CLI provides complete Tana workspace integration through:
- **MCP Server** (`supertag-mcp`) - AI tool integration for Claude, ChatGPT, Cursor, etc.
- **CLI** (`supertag`) - Command-line queries, writes, and management
- **Webhook Server** - HTTP API for automation and Tana Commands

## MCP Tools Reference

### tana_search
Full-text search across Tana workspace using FTS5 indexing.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `limit` | number | No | Max results (default: 20) |
| `includeAncestor` | boolean | No | Include containing project/meeting context (default: true) |
| `createdAfter` | string | No | Filter by creation date (YYYY-MM-DD) |
| `createdBefore` | string | No | Filter by creation date |
| `updatedAfter` | string | No | Filter by update date |
| `updatedBefore` | string | No | Filter by update date |
| `workspace` | string | No | Workspace alias (default: main) |

**Example:**
```
Search my Tana for "authentication implementation"
Find notes about API design created after 2025-01-01
```

### tana_semantic_search
Vector similarity search using embeddings. Finds conceptually related content without exact keyword matches.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural language query |
| `limit` | number | No | Max results (default: 20) |
| `minSimilarity` | number | No | Threshold 0-1 (higher = stricter) |
| `includeContents` | boolean | No | Include full node details |
| `includeAncestor` | boolean | No | Include ancestor context (default: true) |
| `depth` | number | No | Child traversal depth (0-3) |
| `workspace` | string | No | Workspace alias |

**Example:**
```
Find notes semantically related to "knowledge management systems"
Search for concepts similar to "distributed architecture"
```

### tana_tagged
Find all nodes with a specific supertag applied.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| tagname` | string | Yes | Supertag name (e.g., "todo", "meeting") |
| `limit` | number | No | Max results (default: 20) |
| `orderBy` | string | No | Sort order (default: "created") |
| `caseInsensitive` | boolean | No | Case-insensitive matching |
| `createdAfter` | string | No | Filter by creation date |
| `createdBefore` | string | No | Filter by creation date |
| `workspace` | string | No | Workspace alias |

**Example:**
```
Find all my todos in Tana
List meetings from this month
Show all contacts tagged as #person
```

### tana_node
Get full contents of a specific node by ID.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID |
| `depth` | number | No | Child traversal (0 = none, 1+ = children) |
| `workspace` | string | No | Workspace alias |

**Example:**
```
Show me node abc123 with its children
Get the full contents of node xyz789 at depth 2
```

### tana_create
Create new nodes in Tana with supertags, fields, and references.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `supertag` | string | Yes | Supertag name (e.g., "todo") |
| `name` | string | Yes | Node name/title |
| `fields` | object | No | Field values (e.g., `{"Status": "Active"}`) |
| `children` | array | No | Child nodes or references |
| `target` | string | No | Target node ID (INBOX, SCHEMA, or specific) |
| `dryRun` | boolean | No | Validate without creating |
| `workspace` | string | No | Workspace alias |

**Children formats:**
- Plain text: `[{"name": "Child text"}]`
- Nested: `[{"name": "Section", "children": [{"name": "Sub-item"}]}]`
- Reference: `[{"name": "Link", "id": "abc123"}]`
- Inline ref: `[{"name": "See <span data-inlineref-node=\"xyz\">Related</span> item"}]`

**Inline reference syntax:**
```html
<span data-inlineref-node="NODE_ID">Display Text</span>
```

**IMPORTANT:** Never end a node name with an inline reference - always add text after `</span>`.

**Example:**
```
Create a todo called "Review PR #123" with status Active
Create a meeting "Team Standup" with date field set to 2025-12-25
```

### tana_supertags
List all available supertags with usage counts.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Max results (default: 20) |
| `workspace` | string | No | Workspace alias |

**Example:**
```
What supertags do I have in Tana?
List the most used tags in my workspace
```

### tana_stats
Get database statistics: total nodes, supertags, fields, and references.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace` | string | No | Workspace alias |

**Example:**
```
How many nodes are in my Tana?
Show database statistics
```

### tana_sync
Trigger reindex or check sync status.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | No | "index" to reindex, "status" to check (default: index) |
| `workspace` | string | No | Workspace alias |

**Example:**
```
Reindex my Tana database
Check when Tana was last synced
```

### tana_field_values
Query field values extracted from Tana nodes. Fields like "Gestern war gut weil", "Summary", or "Action Items" store structured data in tuple children.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | Yes | "list", "query", or "search" |
| `fieldName` | string | Conditional | Field name (required for "query" mode) |
| `query` | string | Conditional | Search query (required for "search" mode) |
| `limit` | number | No | Max results (default: 100 for query, 50 for search) |
| `offset` | number | No | Skip N results for pagination |
| `createdAfter` | string | No | Filter by creation date (YYYY-MM-DD) |
| `createdBefore` | string | No | Filter by creation date |
| `workspace` | string | No | Workspace alias |

**Mode: list** - Discover available fields:
```
What fields are available in my Tana workspace?
Show me all the different field types I use
```

**Mode: query** - Get values for a specific field:
```
Show me all my "Gestern war gut weil" entries
What summaries have I written this month? (use createdAfter filter)
List my recent action items from meetings
Get the last 20 "Gratitude" entries
```

**Mode: search** - Full-text search across fields:
```
Search my field values for "sprint planning"
Find summaries mentioning "authentication"
Search my action items for anything about "review"
```

### tana_supertag_info
Query supertag inheritance and field definitions. Useful for understanding supertag structure and validating field names.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tagname` | string | Yes | Supertag name (e.g., "todo", "meeting") |
| `mode` | string | No | "fields", "inheritance", or "full" (default: fields) |
| `includeInherited` | boolean | No | Include inherited fields from parent tags |
| `includeAncestors` | boolean | No | Include full ancestor chain with depth info |
| `workspace` | string | No | Workspace alias |

**Mode: fields** - Get field definitions:
```
What fields does the meeting supertag have?
Show me all fields for #project including inherited fields
```

**Mode: inheritance** - Get parent relationships:
```
What does #manager inherit from?
Show me the full inheritance chain for #employee
```

**Mode: full** - Get both fields and inheritance:
```
Tell me everything about the #todo supertag
Show complete structure of #contact tag
```

## CLI Commands

### Search Commands

```bash
# Full-text search
supertag search "meeting notes"

# Semantic search (requires embeddings)
supertag search "project ideas" --semantic

# Filter by supertag
supertag search "review" --tag todo

# Filter by supertag and field value
supertag search --tag meeting --field "Location=Zurich"
supertag search --tag meeting --field "Location~Zur"  # Partial match

# Date filtering
supertag search "sprint" --created-after 2025-01-01
```

### Node Commands

```bash
# Show node contents
supertag nodes show <id> --depth 2

# Show node references
supertag nodes refs <id>

# Recently updated nodes
supertag nodes recent --limit 10
```

### Tag Commands

```bash
# List all supertags
supertag tags list

# Most used supertags
supertag tags top --limit 20

# Show tag schema
supertag tags show meeting

# Show supertag inheritance
supertag tags inheritance manager          # Tree view
supertag tags inheritance manager --flat   # Flattened list
supertag tags inheritance manager --json   # JSON output

# Show supertag fields
supertag tags fields meeting              # Own fields only
supertag tags fields manager --all        # Include inherited fields
supertag tags fields manager --inherited  # Inherited only
supertag tags fields manager --json       # JSON output

# Visualize inheritance graph
supertag tags visualize                   # Mermaid flowchart (default)
supertag tags visualize --format dot      # Graphviz DOT format
supertag tags visualize --format json     # Raw JSON data
supertag tags visualize --root entity     # Subtree from a tag
supertag tags visualize --direction LR    # Left-to-right layout
supertag tags visualize --show-fields     # Show field counts
supertag tags visualize --colors          # Use tag colors (DOT)
supertag tags visualize --output graph.md # Write to file
```

### Create Commands

```bash
# Basic creation
supertag create todo "Buy groceries"

# With fields
supertag create meeting "Team Standup" --date 2025-12-25 --status scheduled

# Multiple supertags
supertag create video,towatch "Tutorial" --url https://example.com

# With children
supertag create todo "Project tasks" \
  --children "First task" \
  --children '{"name": "Reference", "id": "abc123"}'
```

### Workspace Commands

```bash
# List workspaces
supertag workspace list

# Add workspace
supertag workspace add <rootFileId> --alias work

# Set default
supertag workspace set-default work

# Query specific workspace
supertag search "meeting" -w work
```

### Sync Commands

```bash
# Index export files
supertag sync index

# Check status
supertag sync status

# Cleanup old exports
supertag sync cleanup --keep 5
```

### Field Commands

```bash
# List all field names with counts
supertag fields list
supertag fields list --limit 20 --json

# Get values for a specific field
supertag fields values "Summary" --limit 10
supertag fields values "Gestern war gut weil" --after 2025-12-01
supertag fields values "Action Items" --verbose  # Shows parent IDs

# FTS search in field values
supertag fields search "meeting notes"
supertag fields search "project" --field "Summary"  # Search within field

# Export for analysis
supertag fields values "Gratitude" --json > gratitude.json
supertag fields list --json | jq '.[] | .fieldName'
```

### Embedding Commands

```bash
# Configure embeddings
supertag embed config --model bge-m3

# Generate embeddings
supertag embed generate

# Generate with field values included in context
supertag embed generate --include-fields

# Embedding statistics
supertag embed stats
```

## Output Formats

```bash
# Default: Unix TSV (pipe-friendly)
supertag search "meeting"

# Human-friendly with emojis
supertag search "meeting" --pretty

# JSON output
supertag search "meeting" --json

# Verbose with timing
supertag search "meeting" --verbose
```

## Webhook Server

```bash
# Start server
supertag server start --port 3100 --daemon

# Stop server
supertag server stop

# Check status
supertag server status
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search` | POST | Unified search (FTS, semantic, tagged) |
| `/stats` | GET | Database statistics |
| `/nodes/:id` | GET | Get node by ID |
| `/nodes/:id/refs` | GET | Get node references |
| `/tags` | GET | List supertags |
| `/tags/top` | GET | Top supertags by usage |
| `/workspaces` | GET | List available workspaces |
| `/health` | GET | Server health check |

## Configuration

Config file: `~/.config/supertag/config.json`

```json
{
  "output": {
    "pretty": true,
    "humanDates": false
  },
  "embedding": {
    "provider": "ollama",
    "model": "bge-m3"
  }
}
```

## Prerequisites

1. **Tana API Token** - Get from https://app.tana.inc/?bundle=settings&panel=api
2. **Indexed Database** - Run `supertag sync index` after export
3. **Schema Registry** (for creates) - Run `supertag schema sync`
4. **Embeddings** (for semantic search) - Run `supertag embed generate`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TANA_API_TOKEN` | Tana Input API token |
| `TANA_WORKSPACE` | Default workspace alias |
| `DEBUG` | Enable debug logging |

## Data Locations

| Type | Path |
|------|------|
| Config | `~/.config/supertag/` |
| Data | `~/.local/share/supertag/` |
| Exports | `~/Documents/Tana-Export/` |
| Logs | `~/.local/state/supertag/` |

## Performance

| Operation | Speed |
|-----------|-------|
| Indexing | 107k nodes/sec |
| FTS5 Search | <50ms |
| Semantic Search | <100ms |
| Database | ~500MB per 1M nodes |

## Common Workflows

### Daily Export + Sync
```bash
supertag-export run && supertag sync index
```

### Search and Create
```bash
# Find related work
supertag search "authentication" --semantic

# Create follow-up
supertag create todo "Review auth implementation" --status active
```

### Multi-Workspace Queries
```bash
# Search personal workspace
supertag search "vacation plans" -w personal

# Search work workspace
supertag search "sprint goals" -w work
```
