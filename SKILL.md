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

### Progressive Disclosure (Start Here)

The MCP server supports progressive disclosure - a two-tier tool discovery pattern that reduces upfront token cost from ~2000 tokens to ~1000 tokens.

**Workflow:**
1. Call `tana_capabilities` to get a lightweight overview of all tools
2. Call `tana_tool_schema` to load full schemas for specific tools you need
3. Execute tools with validated parameters

### tana_capabilities
Get a lightweight overview of available tools, categorized by function.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter to specific category (query, explore, transcript, mutate, system) |

**Categories:**
- **query**: tana_search, tana_semantic_search, tana_tagged, tana_field_values, tana_batch_get, tana_query, tana_timeline, tana_recent
- **explore**: tana_node, tana_related, tana_stats, tana_supertags, tana_supertag_info
- **transcript**: tana_transcript_list, tana_transcript_show, tana_transcript_search
- **mutate**: tana_create, tana_batch_create, tana_update_node, tana_tag_add, tana_tag_remove, tana_create_tag, tana_set_field, tana_set_field_option, tana_trash_node, tana_done, tana_undone
- **system**: tana_sync, tana_cache_clear, tana_capabilities, tana_tool_schema

**Example:**
```
What tools does the Tana MCP server provide?
Show me query tools for searching content
```

### tana_tool_schema
Load the full JSON schema for a specific tool. Use after `tana_capabilities` to get detailed parameter information.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool` | string | Yes | Tool name (e.g., "tana_search") |

**Example:**
```
Get the full schema for tana_search
What parameters does tana_create accept?
```

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
| `select` | array | No | Fields to include in response (e.g., ["id", "name", "tags"]) |

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
| `select` | array | No | Fields to include in response (e.g., ["nodeId", "name", "similarity"]) |

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
| `select` | array | No | Fields to include in response (e.g., ["id", "name", "created"]) |

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
| `select` | array | No | Fields to include in response (e.g., ["id", "name", "fields"]) |

**Example:**
```
Show me node abc123 with its children
Get the full contents of node xyz789 at depth 2
```

### tana_related
Find nodes related to a given node through references, children, and field links. Uses BFS graph traversal with cycle detection.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Source node ID to find related nodes from |
| `direction` | string | No | Traversal direction: "in", "out", or "both" (default: "both") |
| `types` | array | No | Relationship types: child, parent, reference, field (default: all) |
| `depth` | number | No | Multi-hop traversal depth 0-5 (default: 1) |
| `limit` | number | No | Max results 1-100 (default: 50) |
| `workspace` | string | No | Workspace alias |
| `select` | array | No | Fields to include in response |

**Relationship types:**
- `child`: Node is a child of source
- `parent`: Node is parent of source
- `reference`: Node is referenced by source (inline refs, field refs)
- `field`: Node is connected through a field value

**Example:**
```
Find all nodes related to abc123
What nodes reference project xyz789?
Show incoming connections to meeting abc123
Find nodes connected within 2 hops of task def456
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

**@Name reference syntax (F-094):**
Use `@Name` prefix in field values to reference existing nodes by display name instead of node ID:
```json
{"fields": {"State": "@Open", "Owner": "@John Doe"}}
```
- Automatically looks up the node by name in the database
- Filters by field's target supertag for precise matching
- Falls back to creating a new node if name not found
- Works with comma-separated values: `"@Alice,@Bob"`

**Example:**
```
Create a todo called "Review PR #123" with status Active
Create a meeting "Team Standup" with date field set to 2025-12-25
Create a task "Bug fix" with state set to @Open (reference existing node)
Create a meeting "Standup" with owner @John Doe
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
Trigger reindex, delta-sync, or check sync status.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | No | "index" to reindex, "delta" for incremental sync, "status" to check (default: index) |
| `workspace` | string | No | Workspace alias |

**Delta-sync** (`action="delta"`) fetches only nodes changed since the last sync via Tana Desktop's Local API. Much faster than full reindex. Requires Tana Desktop running with Local API enabled.

The MCP server also runs delta-sync automatically in the background (default: every 5 minutes). Configure interval via `localApi.deltaSyncInterval` in config or `TANA_DELTA_SYNC_INTERVAL` env var (0 disables).

**Example:**
```
Reindex my Tana database
Run incremental sync to get latest changes
Check when Tana was last synced
```

### tana_batch_get
Fetch multiple nodes by ID in a single request. Efficient for bulk lookups.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeIds` | array | Yes | Array of node IDs to fetch (max 100) |
| `depth` | number | No | Child traversal depth 0-3 (default: 0) |
| `select` | array | No | Fields to include (e.g., ["id", "name", "tags"]) |
| `workspace` | string | No | Workspace alias |

**Example:**
```
Get nodes with IDs abc123, def456, ghi789
Fetch 5 nodes with their children (depth 1)
```

### tana_batch_create
Create multiple nodes in a single request. Supports dry-run mode for validation.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodes` | array | Yes | Array of node objects (max 50), each with supertag and name |
| `target` | string | No | Default target node ID for all nodes (INBOX, SCHEMA, or node ID) |
| `dryRun` | boolean | No | Validate without creating (default: false) |
| `workspace` | string | No | Workspace alias |

**Node object structure:**
```json
{
  "supertag": "todo",
  "name": "Task name",
  "fields": {"Status": "Open"},
  "children": [{"name": "Subtask"}]
}
```

**Example:**
```
Create 3 todo items: "Task A", "Task B", "Task C"
Create meeting notes with children for agenda items
Validate batch create with dry-run before creating
```

### tana_update_node
Update a node's name or description. Requires Local API (Tana Desktop running).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID to update |
| `name` | string | No | New node name |
| `description` | string | No | New node description |

### tana_tag_add
Add supertags to a node. Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID |
| `tagIds` | array | Yes | Supertag IDs to add |

### tana_tag_remove
Remove supertags from a node. Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID |
| `tagIds` | array | Yes | Supertag IDs to remove |

### tana_create_tag
Create a new supertag definition. Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Supertag name |
| `description` | string | No | Optional description |

### tana_set_field
Set a text field value on a node. Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID |
| `attributeId` | string | Yes | Field attribute ID |
| `content` | string | Yes | Field value |

### tana_set_field_option
Set a field option (dropdown) value on a node. Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID |
| `attributeId` | string | Yes | Field attribute ID |
| `optionId` | string | Yes | Option ID to set |

### tana_trash_node
Move a node to trash. Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID to trash |

### tana_done
Mark a node as done (checked). Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID |

### tana_undone
Mark a node as not done (unchecked). Requires Local API.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeId` | string | Yes | Tana node ID |

### tana_query
Unified query that combines tag filtering, field filtering, date ranges, and full-text search in a single expressive query. Replaces multi-step discovery→query→filter workflows.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `find` | string | Yes | Tag name to search (e.g., "task", "meeting", "*" for any) |
| `where` | object | No | Field conditions (see below) |
| `orderBy` | string | No | Sort field, prefix with "-" for descending (e.g., "-created") |
| `limit` | number | No | Max results (default: 100) |
| `offset` | number | No | Skip N results for pagination |
| `select` | string/array | No | Field output: `"*"` for all fields, `["Email","Phone"]` for specific |
| `workspace` | string | No | Workspace alias |

**Select clause (field output):**
- Default (no select): Core fields only (id, name, created, updated)
- `"*"`: All supertag fields including inherited fields
- `["Email", "Phone", "Company"]`: Specific fields by name
- Multi-value fields are comma-joined in output

**Where conditions (object keys are field names):**
- Shorthand: `{"Status": "Done"}` (equality)
- Operators: `{"Status": {"eq": "Done"}}`, `{"Status": {"neq": "Cancelled"}}`
- Contains: `{"name": {"contains": "TypeScript"}}`
- Dates: `{"created": {"after": "7d"}}`, `{"created": {"before": "2025-01-01"}}`
- Comparison: `{"priority": {"gt": 5}}`, `{"count": {"lte": 10}}`
- Exists: `{"Summary": {"exists": true}}`
- Empty: `{"Status": {"isEmpty": true}}` - Find nodes with empty/missing field values

**Relative dates:** `today`, `7d` (7 days ago), `1w` (1 week), `1m` (1 month), `1y` (1 year)

**Example:**
```
Find all tasks with status Active created in the last week
{
  "find": "task",
  "where": {
    "Status": "Active",
    "created": {"after": "7d"}
  },
  "orderBy": "-created",
  "limit": 20
}

Find meetings with John in attendees
{
  "find": "meeting",
  "where": {
    "Attendees": {"contains": "John"}
  }
}

Find any nodes matching "project" in name
{
  "find": "*",
  "where": {
    "name": {"contains": "project"}
  }
}

Find contacts with all their fields
{
  "find": "contact",
  "select": "*",
  "limit": 10
}

Find contacts with specific fields (Email, Phone, Company)
{
  "find": "contact",
  "select": ["Email", "Phone", "Company"],
  "limit": 20
}

Find tasks with empty status field
{
  "find": "task",
  "where": {
    "Status": {"isEmpty": true}
  }
}
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
| `select` | array | No | Fields to include in response (e.g., ["fieldName", "count"]) |

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

**Field info includes:**
- `name` - Field name
- `labelId` - Field label node ID
- `inferredDataType` - Data type (text, date, reference, options, etc.)
- `targetSupertagName` - For reference fields, the target supertag (e.g., "project")
- `optionValues` - For inline options fields, array of available values (e.g., ["Active", "Next Up", "Done"])

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

### tana_timeline
Time-bucketed activity view over a date range. Groups nodes by time period with configurable granularity.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | string | No | Start date (ISO or relative: 7d, 1m, today) |
| `to` | string | No | End date (ISO or relative, default: today) |
| `granularity` | string | No | Time bucket size: hour, day, week, month, quarter, year (default: day) |
| `tag` | string | No | Filter by supertag |
| `limit` | number | No | Max items per bucket (default: 10) |
| `workspace` | string | No | Workspace alias |

**Example:**
```
Show me my activity for the last 30 days grouped by week
{
  "from": "30d",
  "granularity": "week"
}

Show meeting activity for 2025 by month
{
  "from": "2025-01-01",
  "to": "2025-12-31",
  "granularity": "month",
  "tag": "meeting"
}
```

### tana_recent
Recently created or updated items within a time period.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | Time period: Nh (hours), Nd (days), Nw (weeks), Nm (months) (default: 24h) |
| `types` | array | No | Filter by supertag names |
| `createdOnly` | boolean | No | Only show created items (not updated) |
| `updatedOnly` | boolean | No | Only show updated items (not created) |
| `limit` | number | No | Max results (default: 20) |
| `workspace` | string | No | Workspace alias |

**Example:**
```
What did I create in the last 7 days?
{
  "period": "7d",
  "createdOnly": true
}

Show recent meetings and tasks from this week
{
  "period": "1w",
  "types": ["meeting", "task"]
}
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

### Timeline Commands

```bash
# Last 30 days, daily buckets (default)
supertag timeline

# Weekly view of last 3 months
supertag timeline --from 3m --granularity week

# Monthly view for a specific year
supertag timeline --from 2025-01-01 --to 2025-12-31 --granularity month

# Filter by supertag
supertag timeline --tag meeting --granularity week

# Recently created/updated items
supertag recent                    # Last 24 hours
supertag recent --period 7d        # Last 7 days
supertag recent --period 1w --types meeting,task

# Only created or only updated
supertag recent --created          # Only newly created
supertag recent --updated          # Only updated (not created)
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

# Show supertag fields (with types, option values, references)
supertag tags fields meeting              # Own fields only
supertag tags fields manager --all        # Include inherited fields
supertag tags fields manager --inherited  # Inherited only
supertag tags fields manager --json       # JSON output
# Field output shows:
#   Type: options (Active, Next Up, Done)     <- inline options with values
#   Type: reference → project                  <- reference field with target

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

### Query Command

The unified query command combines tag filtering, field filtering, and date ranges in a SQL-like syntax:

```bash
# Basic query by tag
supertag query "find task"

# Filter by field value
supertag query "find task where Status = Done"

# Multiple conditions (AND)
supertag query "find task where Status = Active and Priority = High"

# OR conditions (use parentheses)
supertag query "find task where (Status = Done or Status = Cancelled)"

# Contains operator (~)
supertag query "find meeting where Attendees ~ John"
supertag query "find * where name ~ project"

# Date filtering with relative dates
supertag query "find task where created > 7d"        # Last 7 days
supertag query "find meeting where created > 1w"    # Last week
supertag query "find note where created > 1m"       # Last month

# Date filtering with ISO dates
supertag query "find task where created > 2025-01-01"
supertag query "find meeting where created > 2025-01-01 and created < 2025-12-31"

# Ordering results
supertag query "find task order by created"         # Ascending
supertag query "find task order by -created"        # Descending
supertag query "find task where Status = Active order by -created"

# Pagination
supertag query "find task limit 20"
supertag query "find task limit 20 offset 40"

# Field output - include all supertag fields
supertag query "find contact select *"

# Field output - specific fields only
supertag query "find contact select 'Email,Phone,Company'"

# Find nodes with empty/missing field values
supertag query "find task where Status is empty"

# Complete example
supertag query "find task where Status = Active and created > 7d order by -created limit 20"

# Output formats
supertag query "find task" --format json
supertag query "find task" --format csv > tasks.csv
supertag query "find task" --format ids | xargs -I{} supertag nodes show {}
```

**Query syntax:**
```
find <tag> [where <conditions>] [order by [-]<field>] [limit N] [offset N] [select <fields>]
```

**Operators:**
- `=` - Equality
- `!=` - Not equal
- `~` - Contains
- `>`, `<`, `>=`, `<=` - Comparison
- `exists` - Field exists check
- `is empty` - Field is empty or missing

**Select clause (inline in query):**
- No select = Core fields only (id, name, created)
- `select *` = All supertag fields including inherited
- `select "Email,Phone"` = Specific fields by name

**Relative dates:** `today`, `7d`, `1w`, `1m`, `1y`

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

### Batch Commands

```bash
# Fetch multiple nodes by ID
supertag batch get id1 id2 id3

# Pipe from search (get IDs, then fetch full details)
supertag search "meeting" --format ids | supertag batch get --stdin

# With children (depth 1-3)
supertag batch get id1 id2 --depth 2

# Create multiple nodes from JSON file
supertag batch create --file nodes.json

# Create from stdin
echo '[{"supertag":"todo","name":"Task 1"}]' | supertag batch create --stdin

# Dry-run mode (validate without creating)
supertag batch create --file nodes.json --dry-run
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
# Full reindex from export files
supertag sync index

# Delta-sync: fetch only changes since last sync (requires Tana Desktop + Local API)
supertag sync index --delta

# Check status (includes delta-sync info)
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

All commands support `--format <type>` with these options:

| Format | Description | Use Case |
|--------|-------------|----------|
| `table` | Human-readable with emojis | Interactive terminal use |
| `json` | Pretty-printed JSON array | API integration, jq processing |
| `csv` | RFC 4180 compliant CSV | Excel, spreadsheets |
| `ids` | One ID per line | xargs piping, scripting |
| `minimal` | Compact JSON (id, name, tags) | Quick lookups |
| `jsonl` | JSON Lines (streaming) | Log processing, large datasets |

**Format resolution priority:**
1. `--format <type>` flag (explicit)
2. `--json` or `--pretty` flags (shortcuts)
3. `SUPERTAG_FORMAT` environment variable
4. Config file (`output.format`)
5. TTY detection: `table` for interactive, `json` for pipes/scripts

```bash
# Explicit format
supertag search "meeting" --format csv > meetings.csv
supertag tags list --format ids | xargs -I{} supertag tags show {}

# TTY detection (interactive terminal gets table output)
supertag search "meeting"

# Piped output gets JSON (machine-readable)
supertag search "meeting" | jq '.[] | .name'

# JSON with field selection (reduces output)
supertag search "meeting" --json --select id,name,tags
supertag nodes show <id> --json --select id,name,fields

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
    "format": "table",
    "humanDates": false
  },
  "embedding": {
    "provider": "ollama",
    "model": "bge-m3"
  },
  "localApi": {
    "deltaSyncInterval": 5
  },
  "mcp": {
    "toolMode": "full"
  }
}
```

**Output format options:** `table`, `json`, `csv`, `ids`, `minimal`, `jsonl`

**MCP Tool Modes:**

| Mode | Tools | Use Case |
|------|-------|----------|
| `full` | 32 | Standalone use — all tools available |
| `slim` | 14 | Context-optimized — fewer tools for AI agents that perform better with less choice |
| `lite` | 16 | Complement tana-local — analytics, search, and offline tools that tana-local doesn't provide |

Set via `mcp.toolMode` in config or `TANA_MCP_TOOL_MODE` env var.

**Lite Mode** is designed for two-layer MCP setups where tana-local handles live workspace CRUD (read, create, edit, tag, trash) and supertag-mcp provides the analytics and search layer (semantic search, aggregation, timeline, field queries, transcripts). Excluded tools return a helpful message pointing to the equivalent tana-local tool.

```bash
# Start in lite mode
supertag-mcp --lite

# Or via environment variable
TANA_MCP_TOOL_MODE=lite supertag-mcp
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
| `SUPERTAG_FORMAT` | Default output format (table, json, csv, ids, minimal, jsonl) |
| `TANA_LOCAL_API_TOKEN` | Bearer token for Tana Desktop Local API |
| `TANA_LOCAL_API_URL` | Local API endpoint URL (default: `http://localhost:8262`) |
| `TANA_DELTA_SYNC_INTERVAL` | Delta-sync polling interval in minutes (default: 5, 0 disables) |
| `TANA_MCP_TOOL_MODE` | MCP tool mode: `full` (32 tools), `slim` (14 tools), or `lite` (16 tools) |
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

### Debugging Errors
```bash
# Enable debug mode for verbose errors
supertag search "test" --debug

# View error log
supertag errors --last 10

# Export errors for analysis
supertag errors --export > errors.json
```

## MCP Error Response Format

When MCP tools encounter errors, they return structured JSON for AI agent recovery:

```json
{
  "error": {
    "code": "WORKSPACE_NOT_FOUND",
    "message": "Workspace 'books' not found",
    "details": {
      "requestedWorkspace": "books",
      "availableWorkspaces": ["main", "work"]
    },
    "suggestion": "Try one of: main, work",
    "recovery": {
      "canRetry": false,
      "alternatives": ["main", "work"]
    }
  }
}
```

**Error codes for AI agents:**
- `WORKSPACE_NOT_FOUND` - Try `tana_cache_clear`, then use alternative from `alternatives`
- `DATABASE_NOT_FOUND` - User needs to run `supertag sync index`
- `TAG_NOT_FOUND` - Use `tana_supertags` to find correct tag name
- `NODE_NOT_FOUND` - Use `tana_search` to find correct node ID
- `VALIDATION_ERROR` - Check parameter requirements in tool schema
