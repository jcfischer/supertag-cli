# Supertag CLI/MCP Tools Improvement Report

**Date**: January 1, 2026
**Based on**: Anthropic's "Code Execution with MCP" article insights + usage pattern analysis

---

## Executive Summary

Analysis of Anthropic's MCP code execution patterns and supertag-cli usage reveals opportunities for **98%+ token savings** through progressive disclosure, **composable tool pipelines**, and **execution-side filtering**. This report proposes 12 new tools/commands, 8 improvements to existing tools, CLI-specific enhancements for shell composability, and an architectural shift toward code execution patterns.

**Key Principle**: The CLI and MCP server share the same core library. Every new capability should be implemented once in `src/commands/` or `src/services/` and exposed through both interfaces.

---

## Part 1: Key Insights from Anthropic's Article

### 1.1 Progressive Disclosure (98.7% Token Savings)

Anthropic's approach loads tools in stages:
- **Stage 1**: List capabilities only (tool names, brief descriptions)
- **Stage 2**: Load full schemas only when needed
- **Stage 3**: Execute with filtered context

**Current supertag-cli problem**: All 14 tools load full schemas upfront, costing ~2,000 tokens before any query runs.

**Recommendation**: Implement a `tana_capabilities` meta-tool that returns available operations without full schemas. Let Claude decide which tools to load.

### 1.2 Data Filtering in Execution Environment

> "Process everything on the MCP server side, only returning the specific data points the agent needs."

**Current problem**: Tools like `tana_tagged` return full node objects when Claude often only needs names and IDs. A query returning 50 nodes might use 5,000+ tokens when 500 would suffice.

**Recommendation**: Add `fields` parameter to all query tools to select specific return properties.

### 1.3 Code Execution for Control Flow

> "Instead of tool chaining, write code that orchestrates multiple operations."

**Current problem**: Multi-step workflows require round-trips:
1. `tana_supertags` → list tags
2. `tana_tagged "meeting"` → get meetings
3. `tana_node <id>` → get details
4. Repeat for each meeting

**Recommendation**: Add `tana_query` tool that accepts a simple query language or JavaScript-like filter expressions.

---

## Part 2: Current Tool Architecture Analysis

### 2.1 Existing Tools (14 total)

| Category | Tools | Purpose |
|----------|-------|---------|
| **Discovery** | `tana_supertags`, `tana_stats` | Explore workspace structure |
| **Query** | `tana_search`, `tana_tagged`, `tana_semantic_search` | Find nodes |
| **Deep Dive** | `tana_node`, `tana_field_values`, `tana_supertag_info` | Detailed inspection |
| **Transcript** | `tana_transcript_list`, `tana_transcript_show`, `tana_transcript_search` | Meeting transcripts |
| **Mutation** | `tana_create`, `tana_sync` | Write operations |
| **System** | `tana_cache_clear` | Maintenance |

### 2.2 Observed Usage Patterns

From analysis of historical sessions:

**Pattern 1: Discovery → Query → Deep Dive**
```
tana_supertags → tana_tagged "project" → tana_node <id> depth=2
```
This 3-step pattern is repeated constantly and could be a single query.

**Pattern 2: Post-Processing with External Tools**
Users frequently pipe MCP output to `jq` or `grep`:
```bash
tana_tagged "meeting" | jq '.[] | select(.name | contains("Q4"))'
```
This indicates missing filtering capabilities in the tools themselves.

**Pattern 3: Aggregation Needs**
Common questions that require multiple tool calls:
- "How many meetings did I have with [person] this month?"
- "What projects have overdue tasks?"
- "Show me all notes related to [topic] grouped by project"

**Pattern 4: Transcript Workflow**
```
tana_transcript_list → tana_transcript_show <id> → tana_transcript_search "keyword"
```
Could be unified with context-aware defaults.

### 2.3 Token Usage Analysis

| Tool | Typical Output Size | Could Be Reduced To |
|------|---------------------|---------------------|
| `tana_supertags` | 2,000 tokens (100 tags) | 400 tokens (names only) |
| `tana_tagged` | 5,000 tokens (50 nodes) | 500 tokens (with field selection) |
| `tana_search` | 3,000 tokens (20 results) | 600 tokens (minimal mode) |
| `tana_node depth=2` | 4,000 tokens | 800 tokens (selected fields) |

**Estimated savings with field selection: 80%+**

---

## Part 3: Proposed New Tools

### 3.1 Meta/Orchestration Tools

#### `tana_capabilities` (Progressive Disclosure)
```typescript
// Returns lightweight capability list
{
  categories: [
    { name: "query", tools: ["tana_search", "tana_tagged", ...], description: "Find nodes" },
    { name: "mutate", tools: ["tana_create"], description: "Create/modify nodes" },
    ...
  ],
  quickActions: ["search", "create", "sync"]
}
```
**Benefit**: Claude loads this first, then requests specific tool schemas as needed.

#### `tana_query` (Unified Query Language)
```typescript
// Single tool for complex queries
tana_query({
  find: "meeting",
  where: {
    "Attendees": { contains: "John" },
    created: { after: "2025-12-01" }
  },
  select: ["name", "created", "fields.Status"],
  orderBy: "created",
  limit: 10
})
```
**Benefit**: One call replaces `tana_tagged` + `tana_node` + manual filtering.

#### `tana_aggregate` (Statistics/Grouping)
```typescript
// Aggregation queries
tana_aggregate({
  find: "task",
  groupBy: "fields.Status",
  count: true,
  where: { created: { after: "2025-01-01" } }
})
// Returns: { "Done": 45, "In Progress": 12, "Pending": 8 }
```
**Benefit**: Answers "how many X" questions in one call.

### 3.2 Composable Filter Tools

#### `tana_filter` (Post-Query Filtering)
```typescript
// Apply filters to previous query results
tana_filter({
  source: "<previous_query_id>",  // or inline results
  where: { name: { matches: "Q4.*" } },
  select: ["id", "name"]
})
```
**Benefit**: Reduce round-trips for iterative refinement.

#### `tana_transform` (Shape Results)
```typescript
// Transform results into different shapes
tana_transform({
  source: "<query_results>",
  format: "table" | "tree" | "grouped",
  columns: ["name", "created", "fields.Status"]
})
```
**Benefit**: Let Claude request the format it needs for the user.

### 3.3 Relationship Tools

#### `tana_related` (Graph Traversal)
```typescript
// Find related nodes
tana_related({
  nodeId: "abc123",
  direction: "both" | "in" | "out",
  types: ["reference", "child", "field"],
  depth: 2
})
```
**Benefit**: Answer "what's connected to X" without multiple node lookups.

#### `tana_path` (Find Connection)
```typescript
// Find path between two nodes
tana_path({
  from: "nodeA",
  to: "nodeB",
  maxDepth: 5
})
```
**Benefit**: Understand relationships between items.

### 3.4 Temporal Tools

#### `tana_timeline` (Time-Based View)
```typescript
// Get activity over time
tana_timeline({
  tag: "meeting",
  from: "2025-12-01",
  to: "2025-12-31",
  granularity: "day" | "week" | "month"
})
// Returns: [{ date: "2025-12-01", count: 3, items: [...] }, ...]
```
**Benefit**: Answer "what did I do when" questions efficiently.

#### `tana_recent` (Quick Recent Items)
```typescript
// Get recently created/modified items
tana_recent({
  types: ["meeting", "task"],
  period: "7d",
  limit: 20
})
```
**Benefit**: Common "what's new" queries in one call.

### 3.5 Batch/Bulk Tools

#### `tana_batch_get` (Bulk Node Lookup)
```typescript
// Get multiple nodes at once
tana_batch_get({
  nodeIds: ["id1", "id2", "id3"],
  select: ["name", "tags", "fields"]
})
```
**Benefit**: Replaces N sequential `tana_node` calls.

#### `tana_batch_create` (Bulk Creation)
```typescript
// Create multiple nodes atomically
tana_batch_create({
  nodes: [
    { supertag: "task", name: "Task 1", fields: {...} },
    { supertag: "task", name: "Task 2", fields: {...} }
  ],
  target: "INBOX"
})
```
**Benefit**: Create related items without multiple API calls.

### 3.6 Smart Context Tools

#### `tana_context` (Automatic Context Building)
```typescript
// Get relevant context for a topic
tana_context({
  topic: "Project Alpha",
  include: ["meetings", "tasks", "notes"],
  depth: "shallow" | "moderate" | "deep",
  maxTokens: 2000  // Token budget
})
```
**Benefit**: Let the tool decide what's relevant, staying within token budget.

---

## Part 4: Improvements to Existing Tools

### 4.1 Add `select` Parameter to All Query Tools

```typescript
// Current
tana_tagged({ tagname: "meeting" })
// Returns full objects with all fields

// Proposed
tana_tagged({
  tagname: "meeting",
  select: ["id", "name", "created"]  // Only return these fields
})
```

**Impact**: 80% reduction in response size.

### 4.2 Add `format` Parameter for Output Shaping

```typescript
tana_search({
  query: "project",
  format: "minimal" | "standard" | "full"
})

// minimal: Just IDs and names
// standard: Current behavior
// full: Include children, all fields
```

### 4.3 Streaming Support for Large Results

```typescript
tana_tagged({
  tagname: "note",
  limit: 1000,
  stream: true  // Return results incrementally
})
```

### 4.4 Cursor-Based Pagination

```typescript
// Current: offset-based (loses context)
tana_tagged({ tagname: "task", offset: 20, limit: 20 })

// Proposed: cursor-based (stable pagination)
tana_tagged({
  tagname: "task",
  cursor: "eyJpZCI6ImFiYzEyMyJ9",
  limit: 20
})
// Returns: { results: [...], nextCursor: "..." }
```

### 4.5 Add `include` for Optional Expansions

```typescript
tana_node({
  nodeId: "abc123",
  include: ["tags", "fields", "parent", "siblings"]  // Opt-in to expensive lookups
})
```

### 4.6 Dry Run for All Mutation Tools

```typescript
tana_create({
  supertag: "task",
  name: "New task",
  dryRun: true  // Already exists! Extend to other mutation tools
})
```

### 4.7 Query Templates (Saved Queries)

```typescript
// Register a query template
tana_template_save({
  name: "weekly-meetings",
  query: { find: "meeting", where: { created: { after: "7d" } } }
})

// Execute template
tana_template_run({ name: "weekly-meetings" })
```

### 4.8 Improved Error Context

Current errors are often opaque. Add:
- Suggested fixes
- Similar successful queries
- Link to documentation

---

## Part 5: Architectural Recommendations

### 5.1 Implement Tool Chaining Protocol

Allow tools to reference previous results:
```typescript
// Step 1
const searchResult = await tana_tagged({ tagname: "project" });
// Returns: { queryId: "q-123", results: [...] }

// Step 2 - references previous query
const filtered = await tana_filter({
  source: "q-123",  // Reference previous result
  where: { "Status": "Active" }
});
```

**Benefit**: Results stay server-side until needed, reducing token transfer.

### 5.2 Add Query Explanation Mode

```typescript
tana_tagged({
  tagname: "meeting",
  explain: true  // Return query plan instead of executing
})
// Returns: {
//   plan: "Scan tag_applications for 'meeting', join nodes, sort by created",
//   estimatedCost: "~150ms, ~50 results",
//   suggestions: ["Add index on created for better performance"]
// }
```

### 5.3 Implement Result Caching Layer

```typescript
tana_search({
  query: "project",
  cache: {
    ttl: 300,  // Cache for 5 minutes
    key: "project-search"  // Optional cache key
  }
})
```

### 5.4 Add Webhook/Subscription Support

For long-running operations or watching for changes:
```typescript
tana_watch({
  tagname: "task",
  events: ["created", "updated"],
  callback: "https://..."  // Or internal handler
})
```

---

## Part 6: CLI-Specific Improvements

The CLI (`supertag`) mirrors MCP capabilities but offers unique opportunities for shell composability and scripting workflows.

### 6.1 Current CLI Structure

| Command Group | Commands | Equivalent MCP Tool |
|---------------|----------|---------------------|
| `search` | `search <query>`, `--semantic`, `--tag` | `tana_search`, `tana_semantic_search`, `tana_tagged` |
| `nodes` | `show`, `refs`, `recent` | `tana_node` |
| `tags` | `list`, `top`, `show`, `inheritance`, `fields` | `tana_supertags`, `tana_supertag_info` |
| `fields` | `list`, `query`, `search` | `tana_field_values` |
| `transcript` | `list`, `show`, `search` | `tana_transcript_*` |
| `create` | `<supertag> [name]` | `tana_create` |
| `stats` | `[options]` | `tana_stats` |

### 6.2 New CLI Commands (Matching Proposed MCP Tools)

#### `supertag query` (Unified Query Command)
```bash
# SQL-like query syntax for CLI
supertag query "find meeting where Attendees contains 'John' and created > 2025-12-01"

# Or structured flags
supertag query --find meeting --where "Attendees~John" --after 2025-12-01 --select name,created

# JSON query file for complex queries
supertag query --file my-query.json
```

#### `supertag aggregate` (Statistics Command)
```bash
# Count by field
supertag aggregate --tag task --group-by Status
# Output: Done: 45, In Progress: 12, Pending: 8

# Count by time period
supertag aggregate --tag meeting --group-by month --after 2025-01-01
```

#### `supertag related` (Graph Traversal)
```bash
# Find nodes connected to a specific node
supertag related <nodeId> --direction both --depth 2

# Show as tree
supertag related <nodeId> --format tree
```

#### `supertag timeline` (Temporal View)
```bash
# Activity timeline
supertag timeline --tag meeting --from 2025-12-01 --to 2025-12-31 --granularity week

# Recent activity (shorthand)
supertag recent --types meeting,task --period 7d
```

#### `supertag batch` (Bulk Operations)
```bash
# Bulk get nodes
supertag batch get id1 id2 id3 --select name,tags

# Bulk create from JSON
supertag batch create --file nodes.json --target INBOX

# Bulk create from stdin (pipe-friendly)
cat nodes.json | supertag batch create --stdin
```

#### `supertag context` (Smart Context)
```bash
# Get relevant context for a topic
supertag context "Project Alpha" --include meetings,tasks,notes --depth moderate
```

### 6.3 CLI Output Format Improvements

#### Universal `--format` Flag
```bash
# JSON (default for piping)
supertag search "project" --format json

# Table (human-readable)
supertag search "project" --format table

# CSV (for spreadsheets)
supertag search "project" --format csv

# IDs only (for piping to other commands)
supertag search "project" --format ids

# Minimal JSON (IDs + names only)
supertag search "project" --format minimal

# JSONL (JSON Lines - one object per line, streaming-friendly)
supertag search "project" --format jsonl
```

#### Universal `--select` Flag
```bash
# Select specific fields to reduce output
supertag search "meeting" --select id,name,created

# Nested field selection
supertag nodes show <id> --select name,fields.Status,fields.Priority
```

#### Quiet and Verbose Modes
```bash
# Quiet: only output data, no headers/stats
supertag search "project" -q

# Verbose: include debug info, query plans
supertag search "project" -v
```

### 6.4 Shell Composability Patterns

#### Pipe-Friendly Design
```bash
# Get IDs, pipe to batch show
supertag search "project" --format ids | xargs supertag batch get

# Filter with jq (but prefer built-in filters)
supertag tags list --format json | jq '.[] | select(.count > 10)'

# Chain commands with process substitution
supertag nodes show $(supertag search "meeting" --format ids --limit 1)
```

#### xargs Integration
```bash
# Process each result with a command
supertag search "task" --format ids | xargs -I {} supertag nodes show {}

# Parallel processing
supertag search "project" --format ids | xargs -P 4 -I {} supertag related {}
```

#### Built-in Filtering (Reduce Need for jq)
```bash
# Filter in CLI instead of piping to jq
supertag search "meeting" --where "created > 2025-12-01" --where "tags contains Q4"

# Exclude patterns
supertag tags list --exclude "^_" --exclude "test"
```

### 6.5 New CLI-Specific Features

#### Interactive Mode
```bash
# Start interactive REPL
supertag interactive

> search project
Found 45 results...
> filter Status = Active
Filtered to 12 results...
> show 1
[Shows first result in detail]
> export csv > projects.csv
Exported 12 rows
```

#### Watch Mode
```bash
# Watch for changes (useful for dashboards)
supertag watch --tag task --interval 30s --on-change "notify-send 'New task!'"

# Stream new items
supertag search "meeting" --watch --since now
```

#### Saved Queries (Aliases)
```bash
# Save a query
supertag alias save weekly-meetings "search meeting --after 7d --select name,created"

# Run saved query
supertag alias run weekly-meetings

# List aliases
supertag alias list
```

#### Shell Completion Enhancements
```bash
# Dynamic completion for supertag names
supertag search --tag <TAB>
# Shows: meeting, task, project, contact...

# Dynamic completion for field names
supertag search --where <TAB>
# Shows: Status, Priority, Due Date...

# Node ID completion from recent history
supertag nodes show <TAB>
# Shows: abc123 (Meeting with John), def456 (Project Alpha)...
```

### 6.6 CLI Configuration Improvements

#### Profile Support
```bash
# Different profiles for different workspaces
supertag --profile work search "meeting"
supertag --profile personal search "todo"

# Set default profile
supertag config --default-profile work
```

#### Output Defaults
```bash
# Set default format
supertag config --default-format table

# Set default limit
supertag config --default-limit 50

# Per-command defaults
supertag config --command search --default-format minimal
```

### 6.7 CLI/MCP Parity Matrix

| Feature | CLI | MCP | Notes |
|---------|-----|-----|-------|
| Search | `supertag search` | `tana_search` | ✅ Parity |
| Semantic Search | `--semantic` flag | `tana_semantic_search` | ✅ Parity |
| Tagged Query | `--tag` flag | `tana_tagged` | ✅ Parity |
| Node Details | `nodes show` | `tana_node` | ✅ Parity |
| **Query Language** | `supertag query` | `tana_query` | 🆕 Proposed |
| **Aggregate** | `supertag aggregate` | `tana_aggregate` | 🆕 Proposed |
| **Related** | `supertag related` | `tana_related` | 🆕 Proposed |
| **Batch Get** | `supertag batch get` | `tana_batch_get` | 🆕 Proposed |
| **Timeline** | `supertag timeline` | `tana_timeline` | 🆕 Proposed |
| **Context** | `supertag context` | `tana_context` | 🆕 Proposed |
| Interactive Mode | `supertag interactive` | N/A | CLI-only |
| Watch Mode | `supertag watch` | Webhooks | Different paradigms |
| Aliases | `supertag alias` | Query templates | Similar concepts |

---

## Part 7: Implementation Priority

### Phase 1: Quick Wins (High Impact, Low Effort)
**Theme: Reduce output verbosity across CLI and MCP**

| # | Feature | CLI | MCP | Impact |
|---|---------|-----|-----|--------|
| 1 | `--select` parameter | All query commands | All query tools | 80% token reduction |
| 2 | `--format minimal/ids/jsonl` | Universal flag | `format` param | Better piping, less noise |
| 3 | `tana_capabilities` | N/A | Progressive disclosure | 50% schema token savings |
| 4 | `supertag batch get` | `batch get <ids>` | `tana_batch_get` | Replace N sequential calls |

### Phase 2: Query Power
**Theme: One query to rule them all**

| # | Feature | CLI | MCP | Impact |
|---|---------|-----|-----|--------|
| 5 | Unified query | `supertag query` | `tana_query` | 60% round-trip reduction |
| 6 | Aggregation | `supertag aggregate` | `tana_aggregate` | Answer "how many X" questions |
| 7 | Cursor pagination | `--cursor` | `cursor` param | Stable large result sets |
| 8 | Query aliases | `supertag alias` | Query templates | Reusable complex queries |
| 9 | Built-in `--where` filter | `--where "field=val"` | `where` param | Replace jq post-processing |

### Phase 3: Relationships & Time
**Theme: Graph and temporal queries**

| # | Feature | CLI | MCP | Impact |
|---|---------|-----|-----|--------|
| 10 | Related nodes | `supertag related` | `tana_related` | Graph traversal in one call |
| 11 | Timeline view | `supertag timeline` | `tana_timeline` | Activity patterns |
| 12 | Smart context | `supertag context` | `tana_context` | Token-budget-aware context |
| 13 | `nodes recent` improvements | `--types`, `--period` | Enhanced params | Better "what's new" queries |

### Phase 4: Advanced & CLI-Only
**Theme: Power user features**

| # | Feature | CLI | MCP | Impact |
|---|---------|-----|-----|--------|
| 14 | Interactive mode | `supertag interactive` | N/A | REPL for exploration |
| 15 | Watch mode | `supertag watch` | Webhooks | Real-time updates |
| 16 | Shell completion | Dynamic completion | N/A | Faster CLI usage |
| 17 | Result chaining | Pipe-friendly | Query references | Keep data server-side |
| 18 | Query explanation | `--explain` | `explain: true` | Debug/optimize queries |

---

## Part 8: Expected Outcomes

### Token Savings
| Improvement | Estimated Savings |
|-------------|-------------------|
| Progressive disclosure | 50% reduction in tool schema tokens |
| Field selection | 80% reduction in response tokens |
| Unified query tool | 60% reduction in round-trips |
| Result chaining | 40% reduction in data transfer |
| **Combined** | **90%+ overall token savings** |

### User Experience
- **Faster responses**: Fewer round-trips = lower latency
- **More complex queries**: Single-call aggregations and relationships
- **Better context management**: Token-budget-aware tools
- **Improved debugging**: Query explanation and better errors

### Developer Experience
- **Composable tools**: Build complex operations from simple primitives
- **Predictable outputs**: Format options for consistent responses
- **Easier testing**: Dry-run and explain modes

---

## Appendix A: Tool Comparison Matrix

| Current Tool | Proposed Enhancement | New Complementary Tool |
|--------------|---------------------|------------------------|
| `tana_search` | + `select`, `format` | `tana_query` |
| `tana_tagged` | + `select`, `format`, cursor | `tana_aggregate` |
| `tana_node` | + `include` | `tana_batch_get`, `tana_related` |
| `tana_semantic_search` | + `select`, token budget | `tana_context` |
| `tana_supertags` | + `format: minimal` | (covered by `tana_capabilities`) |
| `tana_transcript_*` | + unified interface | `tana_timeline` |
| `tana_create` | + batch mode | `tana_batch_create` |

---

## Appendix B: Example Workflows - Before/After

### Workflow 1: Find Active Projects with Overdue Tasks

**Before (5+ tool calls):**
```
1. tana_tagged { tagname: "project" }  → 50 projects
2. For each project with Status=Active:
   3. tana_node { nodeId: X, depth: 2 }  → get tasks
   4. Filter tasks where Due Date < today
5. Aggregate results manually
```

**After (1 tool call):**
```
tana_query {
  find: "task",
  where: {
    "parent.tags": { contains: "project" },
    "parent.fields.Status": "Active",
    "fields.Due Date": { before: "today" }
  },
  groupBy: "parent.name",
  select: ["name", "fields.Due Date", "parent.name"]
}
```

### Workflow 2: Get Meeting Context

**Before (3+ tool calls):**
```
1. tana_search { query: "Project Alpha meeting" }
2. tana_node { nodeId: <result>, depth: 3 }
3. tana_related { ... } (if it existed)
```

**After (1 tool call):**
```
tana_context {
  topic: "Project Alpha",
  include: ["meetings", "notes", "tasks"],
  depth: "moderate",
  maxTokens: 3000
}
```

---

## Appendix C: CLI Workflow Examples - Before/After

### Workflow 1: Find All Meetings with John This Month

**Before:**
```bash
# Multiple steps with jq post-processing
supertag search "meeting" --tag meeting --after 2025-12-01 --format json \
  | jq '.[] | select(.fields.Attendees | contains("John"))'
```

**After:**
```bash
# Single command with built-in filtering
supertag query --find meeting --where "Attendees~John" --after 2025-12-01
```

### Workflow 2: Get Node Details for Search Results

**Before:**
```bash
# Multiple sequential calls
for id in $(supertag search "project" --format json | jq -r '.[].id'); do
  supertag nodes show $id
done
```

**After:**
```bash
# Single batch call
supertag search "project" --format ids | xargs supertag batch get --select name,tags,fields
```

### Workflow 3: Task Statistics by Status

**Before:**
```bash
# Manual aggregation
supertag search --tag task --format json | jq 'group_by(.fields.Status) | map({status: .[0].fields.Status, count: length})'
```

**After:**
```bash
# Built-in aggregation
supertag aggregate --tag task --group-by Status
```

---

## Conclusion

The supertag-cli and MCP tools are functional but not optimized for the agentic AI patterns Anthropic recommends. By implementing:

1. **For MCP**: Progressive disclosure, field selection, unified queries, and result chaining
2. **For CLI**: Universal format flags, built-in filtering, batch operations, and shell composability

We can achieve **90%+ token savings** for AI agents while making the CLI more powerful for shell scripting and automation.

**The key principle**: Both interfaces share the same core library. Every improvement benefits both:
- MCP tools reduce token usage for Claude
- CLI commands become more composable for shell workflows
- Same underlying functions, two optimized interfaces

Start with Phase 1 (quick wins) to see immediate benefits, then progressively add query power and relationship tools based on real usage patterns.

---

*Report generated by PAI analysis of supertag-cli architecture and Anthropic's MCP code execution best practices.*
