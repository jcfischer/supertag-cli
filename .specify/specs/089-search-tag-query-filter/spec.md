---
id: "089"
feature: "Search Tag Query Filter"
status: "draft"
created: "2026-01-07"
---

# Specification: Search Tag Query Filter

## Overview

When using `supertag search` with both a query and `--tag` flag, the query should filter results by name. Currently, the query is completely ignored when `--tag` is specified, returning all nodes with the tag regardless of the search term.

**Current behavior (bug):**
```bash
supertag search "Bikepacking" --tag topic
# Returns ALL #topic nodes, ignores "Bikepacking"
```

**Expected behavior:**
```bash
supertag search "Bikepacking" --tag topic
# Returns only #topic nodes whose name contains "Bikepacking"
```

## User Scenarios

### Scenario 1: Find specific topic by name

**As a** CLI user
**I want to** search for a topic by name AND tag
**So that** I can quickly find the correct #topic node without scrolling through all topics

**Acceptance Criteria:**
- [ ] `supertag search "Velo" --tag topic` returns only #topic nodes containing "Velo"
- [ ] `supertag search "Bikepacking" --tag topic` returns only #topic nodes containing "Bikepacking"
- [ ] Empty results shown when no matching nodes found

### Scenario 2: Find person by partial name

**As a** CLI user
**I want to** search for a person by partial name
**So that** I can find contact nodes without knowing the exact full name

**Acceptance Criteria:**
- [ ] `supertag search "Katja" --tag person` returns #person nodes containing "Katja"
- [ ] Search is case-insensitive
- [ ] Partial matches work (substring matching)

### Scenario 3: List all nodes with tag (no query)

**As a** CLI user
**I want to** list all nodes with a tag when no query is provided
**So that** existing behavior is preserved for tag-only searches

**Acceptance Criteria:**
- [ ] `supertag search --tag topic` returns all #topic nodes (existing behavior)
- [ ] No regression in tag-only searches

## Functional Requirements

### FR-1: Pass query to tagged search handler

When both a query string and `--tag` flag are provided, pass the query to `handleTaggedSearch`.

**Validation:** Query parameter is available in `handleTaggedSearch` function

### FR-2: Filter tagged results by name

When a query is provided with `--tag`, filter the results to only include nodes whose name contains the query string (case-insensitive).

**Validation:**
- `supertag search "Velo" --tag topic` returns subset of `supertag search --tag topic`
- All returned nodes have names containing "Velo"

### FR-3: Preserve tag-only behavior

When `--tag` is provided without a query, return all nodes with that tag (current behavior).

**Validation:** `supertag search --tag topic` returns same results as before

### FR-4: Update MCP tana_tagged tool

The MCP `tana_tagged` tool should also support an optional `query` parameter for name filtering.

**Validation:**
- `tana_tagged { tagname: "topic", query: "Velo" }` returns filtered results
- `tana_tagged { tagname: "topic" }` returns all (existing behavior)

### FR-5: Support existing field filters with query

The combination of `--tag`, `--field`, and query should all work together.

**Validation:** `supertag search "Meeting" --tag day --field "Location=Zurich"` filters by all three criteria

## Non-Functional Requirements

- **Performance:** Name filtering should not significantly impact query time (use SQL WHERE clause, not post-processing)
- **Failure Behavior:**
  - On no matches: Return empty result set with appropriate message
  - On invalid tag: Show "tag not found" error (existing behavior)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| SearchOptions | CLI command options | query, tag, field, limit |
| TaggedSearchParams | Parameters for tagged search | tagname, query (new), field, limit |

## Success Criteria

- [ ] `supertag search "Bikepacking" --tag topic` returns only matching #topic nodes
- [ ] `supertag search --tag topic` (no query) still returns all #topic nodes
- [ ] MCP `tana_tagged` supports optional `query` parameter
- [ ] All existing search tests pass
- [ ] New tests cover query+tag combination

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Users expect substring matching | User requests exact match mode | User feedback |
| Case-insensitive matching is preferred | User wants case-sensitive option | User feedback |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes | Version/Contract |
|--------|-------------|---------------------------|------------------|
| SQLite FTS | Full-text search | Query syntax changes | SQLite 3.x |
| tag_applications table | Tag-node relationships | Schema changes | Current schema |

### Downstream Consumers

| System | What They Expect | Breaking Change Threshold |
|--------|-----------------|--------------------------|
| CLI users | `--tag` flag behavior | Adding query support is additive |
| MCP clients | `tana_tagged` schema | New optional param is backwards compatible |

## Out of Scope

- Regex matching in name filter
- Multiple tag filtering (AND/OR logic)
- Fuzzy/phonetic name matching
- Ranking by relevance (simple contains is sufficient)

## Technical Notes

**Files to modify:**
1. `src/commands/search.ts` - Pass query to `handleTaggedSearch`, add name filtering
2. `src/mcp/schemas.ts` - Add optional `query` param to `taggedSchema`
3. `src/mcp/tools/tagged.ts` - Implement query filtering

**Root cause location:** `src/commands/search.ts` line 162:
```typescript
case "tagged":
  await handleTaggedSearch(options.tag!, options, dbPath);  // query not passed
```
