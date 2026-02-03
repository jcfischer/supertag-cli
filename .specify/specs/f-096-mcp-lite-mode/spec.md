# Specification: MCP Lite Mode (Complement tana-local)

**Feature ID:** F-096
**Status:** SPECIFIED
**Priority:** High
**Depends on:** F-094 (Tana Local API Integration), F-095 (Delta-Sync & Slim Mode)

---

## Overview

Tana shipped `tana-local`, an official MCP server built into Tana Desktop that provides 18 tools for live workspace CRUD: search, read, create (via Tana Paste), edit, tag management, field operations, checkbox state, trash, and calendar nodes. This covers the same ground as supertag-mcp's 12 mutation tools and several read tools.

Running both servers simultaneously with overlapping tools confuses AI agents (which `search` do I call?), wastes context window on duplicate tool definitions, and creates conflicting results (live vs export-based data for the same operation).

**Lite mode** is a new MCP tool mode that exposes **only** the tools tana-local does not provide: full-text search with relevance ranking, semantic/vector search, analytics (aggregation, timeline, recent activity), transcript access, graph traversal, field value queries, and offline batch lookups. All CRUD operations are delegated to tana-local.

This implements the **two-layer MCP architecture** taught in the supertag course (c-002):
- **Layer 1:** tana-local (foundation) — live workspace CRUD
- **Layer 2:** supertag-mcp lite (enhancement) — analytics, search, offline

**Target state:** Users running tana-local launch supertag-mcp with `--lite` to get complementary analytics tools with zero tool duplication. Users without tana-local continue using `full` mode.

---

## User Scenarios

### Scenario 1: Two-Layer Setup

- **Given** a user has tana-local MCP enabled in Tana Desktop
- **And** they add supertag-mcp to their Claude Code config with `--lite`
- **When** the MCP server starts
- **Then** only analytics/search tools are registered (no mutation or CRUD tools)
- **And** the AI agent sees complementary tools from both servers with no overlap

### Scenario 2: Semantic Search + Live Create

- **Given** both tana-local and supertag-mcp (lite) are running
- **When** the user asks "Find notes about marketing strategy and create a summary"
- **Then** the agent uses `tana_semantic_search` (supertag) to find related content
- **And** the agent uses `import_tana_paste` (tana-local) to create the summary node
- **And** no tool selection confusion occurs because domains don't overlap

### Scenario 3: Analytics Workflow

- **Given** supertag-mcp is running in lite mode
- **When** the user asks "How many tasks did I complete last month?"
- **Then** the agent uses `tana_aggregate` to group completed tasks by time period
- **And** tana-local is not involved (it has no aggregation capability)

### Scenario 4: Offline Analysis

- **Given** supertag-mcp is running in lite mode
- **And** Tana Desktop is closed (tana-local unavailable)
- **When** the user asks "Search my meeting transcripts for budget discussions"
- **Then** `tana_transcript_search` works against the local export database
- **And** results are returned without requiring Tana to be running

### Scenario 5: Fallback to Full Mode

- **Given** a user does NOT have tana-local configured
- **When** they run supertag-mcp without `--lite`
- **Then** all 32 tools are available (full mode, existing behavior)
- **And** the user has complete Tana access through supertag-mcp alone

### Scenario 6: Disabled Tool Error Message

- **Given** supertag-mcp is running in lite mode
- **When** an AI agent attempts to call `tana_create`
- **Then** a helpful error is returned: "Tool 'tana_create' is not available in lite mode. Use tana-local's import_tana_paste for creating nodes."
- **And** the error includes the equivalent tana-local tool name

---

## Functional Requirements

### FR-1: Lite Mode Tool Set

Add a `'lite'` tool mode alongside existing `'full'` and `'slim'` modes. Lite mode exposes exactly 16 tools:

**Query tools (7):**

| Tool | Justification |
|------|---------------|
| `tana_search` | FTS5 ranked relevance search. tana-local's `textContains` is substring match without ranking. |
| `tana_semantic_search` | Vector similarity search. No tana-local equivalent. |
| `tana_query` | Unified offline query DSL with tag+field+date filtering. Works without Tana running. |
| `tana_aggregate` | Aggregation with grouping and counting. No tana-local equivalent. |
| `tana_timeline` | Time-bucketed activity view. No tana-local equivalent. |
| `tana_recent` | Recent activity feed with period filtering. No tana-local equivalent. |
| `tana_field_values` | Cross-node field querying and search. No tana-local equivalent. |

**Explore tools (3):**

| Tool | Justification |
|------|---------------|
| `tana_batch_get` | Batch node lookups from export DB. tana-local's `read_node` is single-node only. |
| `tana_related` | Graph traversal via references/children/fields. No tana-local equivalent. |
| `tana_stats` | Workspace-level statistics (counts, sizes). No tana-local equivalent. |

**Transcript tools (3):**

| Tool | Justification |
|------|---------------|
| `tana_transcript_list` | List meetings with transcripts. No tana-local equivalent. |
| `tana_transcript_show` | Show transcript content. No tana-local equivalent. |
| `tana_transcript_search` | Full-text transcript search. No tana-local equivalent. |

**System tools (3):**

| Tool | Justification |
|------|---------------|
| `tana_sync` | Reindex from exports (action=index) and status check (action=status). Delta action still available for background polling. |
| `tana_cache_clear` | Cache management. No tana-local equivalent. |
| `tana_capabilities` | Tool discovery. Updated to reflect lite mode tool set. |

### FR-2: Excluded Tools (15 tools)

These tools are excluded in lite mode because tana-local provides equivalent or superior live functionality:

| Excluded Tool | tana-local Equivalent | Reason |
|---------------|----------------------|--------|
| `tana_create` | `import_tana_paste` | Tana Paste is more powerful (hierarchical, views, searches) |
| `tana_batch_create` | `import_tana_paste` | Single Tana Paste import handles multiple nodes |
| `tana_update_node` | `edit_node` | Live edit with search/replace semantics |
| `tana_tag_add` | `tag` (action: add) | Live tag operations |
| `tana_tag_remove` | `tag` (action: remove) | Live tag operations |
| `tana_create_tag` | `create_tag` | Live tag creation with field definitions |
| `tana_set_field` | `set_field_content` | Live field setting |
| `tana_set_field_option` | `set_field_option` | Live option field setting |
| `tana_trash_node` | `trash_node` | Live trash operation |
| `tana_done` | `check_node` | Live checkbox operation |
| `tana_undone` | `uncheck_node` | Live checkbox operation |
| `tana_node` | `read_node` + `get_children` | Live node reading with depth |
| `tana_supertags` | `list_tags` | Live tag listing |
| `tana_supertag_info` | `get_tag_schema` | Live schema with edit instructions |
| `tana_tagged` | `search_nodes` (hasType filter) | Live structured search by tag |

### FR-3: --lite CLI Flag

The `supertag-mcp` binary accepts a `--lite` flag:

```bash
# Start in lite mode (complement tana-local)
supertag-mcp --lite

# Start in full mode (default, standalone)
supertag-mcp

# Start in slim mode (existing, context-optimized)
supertag-mcp --slim
```

### FR-4: Configuration Integration

Lite mode is configurable via three mechanisms (priority order):

1. **CLI flag:** `supertag-mcp --lite` (highest priority)
2. **Environment variable:** `SUPERTAG_MCP_MODE=lite`
3. **Config file:** `~/.config/supertag/config.json` → `mcp.toolMode: "lite"`

### FR-5: Tool Discovery Update

`tana_capabilities` output adapts to the current mode:
- In lite mode, only lite tools appear in the capabilities response
- The response includes a `mode` field indicating `"lite"`
- Category counts reflect available tools only

### FR-6: Helpful Rejection Messages

When a disabled tool is called in lite mode, return a structured error with:
- The tool name that was called
- The current mode (`lite`)
- The **equivalent tana-local tool** name (e.g., "Use tana-local's `import_tana_paste` instead")
- A suggestion to switch to `full` mode if tana-local is not available

### FR-7: tana_tool_schema Availability

`tana_tool_schema` is removed from the lite tool set (not needed when capabilities covers discovery). This keeps the lite set at exactly 16 tools matching course documentation.

---

## Non-Functional Requirements

### NFR-1: Context Window Efficiency

Lite mode tool definitions consume less context than full mode. With 16 vs 32 tools, approximately 50% reduction in tool definition tokens.

### NFR-2: No Breaking Changes

- `full` mode remains the default and is unchanged
- `slim` mode continues to work as before
- Existing configurations are not affected

### NFR-3: Startup Logging

Server startup log includes the active mode and tool count:
```
supertag-mcp v2.x.x starting (mode: lite, tools: 16)
```

---

## Out of Scope

- Auto-detection of tana-local availability (future enhancement)
- Dynamic mode switching at runtime
- Merging slim and lite modes (they serve different purposes: slim optimizes context window for standalone use; lite complements tana-local)
- Changes to tana-local's behavior or tools
