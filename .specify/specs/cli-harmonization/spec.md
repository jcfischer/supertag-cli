---
id: "017"
feature: "CLI Harmonization"
status: "completed"
created: "2025-12-22"
completed: "2025-12-23"
---

# Specification: CLI Harmonization

## Overview

Unify the supertag CLI command structure and webhook server endpoints around a consistent `object action` pattern, consolidate duplicate functionality between `query` and `show` commands, introduce a unified `search` command, and normalize flag/parameter names across all interfaces. This is a breaking change that simplifies both the CLI (13 → 10 top-level commands) and the webhook API (scattered endpoints → RESTful structure).

## User Scenarios

### Scenario 1: Unified Search Experience

**As a** CLI user
**I want to** search my Tana data with a single `search` command
**So that** I don't need to remember whether to use `query search`, `embed search`, or `show tagged`

**Acceptance Criteria:**
- [ ] `supertag search <query>` performs full-text search (default)
- [ ] `supertag search <query> --semantic` performs vector similarity search
- [ ] `supertag search --tag <tagname>` finds nodes by supertag
- [ ] `supertag search <query> --show` displays full node content (fields, children)
- [ ] `supertag search <query> --show --depth 2` traverses children to specified depth
- [ ] All search variants support `--limit`, `--workspace`, and `--json` flags

### Scenario 2: Consistent Node Access

**As a** CLI user
**I want to** access nodes through a `nodes` command group
**So that** I have a clear mental model for node operations

**Acceptance Criteria:**
- [ ] `supertag nodes show <id>` displays a single node by ID
- [ ] `supertag nodes show <id> --depth 3` traverses children
- [ ] `supertag nodes refs <id>` shows reference graph for a node
- [ ] `supertag nodes recent` shows recently updated nodes
- [ ] All node commands support `--json` and `--workspace` flags

### Scenario 3: Unified Statistics

**As a** CLI user
**I want to** view all statistics with a single `stats` command
**So that** I don't need to run `query stats` and `embed stats` separately

**Acceptance Criteria:**
- [ ] `supertag stats` shows combined database and embedding statistics
- [ ] `supertag stats --db` shows only database statistics
- [ ] `supertag stats --embed` shows only embedding statistics
- [ ] `supertag stats --filter` shows content filtering breakdown
- [ ] Output is formatted consistently across all stat types

### Scenario 4: Supertag Discovery

**As a** CLI user
**I want to** explore supertags through a `tags` command group
**So that** tag-related operations are grouped logically

**Acceptance Criteria:**
- [ ] `supertag tags list` shows all supertags with counts
- [ ] `supertag tags top` shows most-used supertags (with `--limit`)
- [ ] `supertag tags show <name>` shows schema fields for a supertag
- [ ] `supertag tags search <query>` finds supertags by name pattern

### Scenario 5: Normalized Flag Experience

**As a** CLI user
**I want to** use consistent flags across all commands
**So that** I don't need to remember `-k` vs `--limit` or `--json` vs `--format json`

**Acceptance Criteria:**
- [ ] All commands use `--limit` or `-l` for result limits (not `-k`)
- [ ] All commands use `--json` for JSON output (not `--format json`)
- [ ] All commands use `--show` or `-s` for verbose/full content output
- [ ] All commands use `--depth` or `-d` for child traversal depth
- [ ] All commands use `--workspace` or `-w` for workspace selection

### Scenario 6: Unified Webhook Search

**As a** webhook API consumer
**I want to** use a single `/search` endpoint with type parameter
**So that** I don't need to call different endpoints for FTS vs semantic vs tag search

**Acceptance Criteria:**
- [ ] `POST /search` with `{"query": "x"}` performs FTS (default)
- [ ] `POST /search` with `{"query": "x", "type": "semantic"}` performs vector search
- [ ] `POST /search` with `{"tag": "todo"}` finds nodes by supertag
- [ ] `POST /search` with `{"query": "x", "show": true}` includes full node content
- [ ] All search types support `limit`, `workspace`, and `format` parameters

### Scenario 7: RESTful Node Access via Webhook

**As a** webhook API consumer
**I want to** access nodes through RESTful `/nodes` endpoints
**So that** the API follows standard REST conventions

**Acceptance Criteria:**
- [ ] `GET /nodes/:id` returns a single node by ID
- [ ] `GET /nodes/:id?depth=3` traverses children
- [ ] `GET /nodes/:id/refs` returns reference graph
- [ ] `POST /nodes/find` finds nodes by pattern/tag criteria
- [ ] `GET /nodes/recent` returns recently updated nodes

### Scenario 8: Unified Webhook Statistics

**As a** webhook API consumer
**I want to** get all statistics from a single `/stats` endpoint
**So that** I don't need to call `/stats` and `/embed-stats` separately

**Acceptance Criteria:**
- [ ] `GET /stats` returns combined database and embedding statistics
- [ ] `GET /stats?type=db` returns only database statistics
- [ ] `GET /stats?type=embed` returns only embedding statistics
- [ ] `GET /stats?type=filter` returns content filtering breakdown

### Scenario 9: RESTful Tag Endpoints

**As a** webhook API consumer
**I want to** access supertags through `/tags` endpoints
**So that** the API is intuitive and RESTful

**Acceptance Criteria:**
- [ ] `GET /tags` lists all supertags with counts
- [ ] `GET /tags/top?limit=10` returns most-used supertags
- [ ] `GET /tags/:name` returns schema fields for a supertag

## Functional Requirements

### FR-1: Add Top-Level `search` Command

Add a new `supertag search` command that unifies all search operations with flags to control search type and output verbosity.

**Validation:**
- `supertag search --help` shows all options
- `supertag search "meeting"` returns FTS results
- `supertag search "meeting" --semantic` returns vector search results
- `supertag search --tag todo` returns tagged nodes

### FR-2: Add Top-Level `nodes` Command Group

Create a new `nodes` command group that consolidates node access operations.

**Validation:**
- `supertag nodes --help` shows subcommands: show, refs, recent
- `supertag nodes show <id>` works identically to current `show node <id>`
- Depth traversal works with `--depth` flag

### FR-3: Add Top-Level `stats` Command

Create a unified statistics command that combines all stat outputs.

**Validation:**
- `supertag stats` outputs combined stats
- Flag filtering works correctly (`--db`, `--embed`, `--filter`)

### FR-4: Add Top-Level `tags` Command Group

Create a new `tags` command group for supertag exploration.

**Validation:**
- `supertag tags list` works like current `query tags`
- `supertag tags top` works like current `query top-tags`
- `supertag tags show <name>` works like current `schema show <name>`

### FR-5: Add `--show` Flag to FTS Search

Add the `--show` flag to full-text search for parity with semantic search.

**Validation:**
- `supertag search "query" --show` displays full node content
- `supertag search "query" --show --depth 2` traverses children

### FR-6: Normalize All Flags

Standardize flag names across all commands.

**Validation:**
- `--limit` works on all commands that limit results
- `--json` works on all commands that can output JSON
- `--show` works on all search-type commands
- `--depth` works on all commands that support child traversal

### FR-7: Remove Deprecated Commands

Remove the old command structure entirely (breaking change).

**Validation:**
- `supertag query search` returns "command not found" or deprecation error
- `supertag show tagged` returns "command not found" or deprecation error
- `supertag query stats` returns "command not found" or deprecation error

### FR-8: Convert Schema to Proper Subcommands

Convert the `schema` command from manual argument parsing to Commander subcommands.

**Validation:**
- `supertag schema --help` shows subcommands properly
- `supertag schema sync` works as before
- `supertag schema list` works as before

### FR-9: Update Help Text and Examples

Update all help text to reflect new command structure.

**Validation:**
- `supertag --help` shows new command structure
- Examples in help text use new commands
- Command groups are clearly documented

### FR-10: Unify Webhook Search Endpoint

Consolidate `/search` and `/semantic-search` into a single `/search` endpoint with type parameter.

**Validation:**
- `POST /search {"query": "x"}` returns FTS results
- `POST /search {"query": "x", "type": "semantic"}` returns vector results
- `POST /search {"tag": "todo"}` returns tagged nodes
- Old `/semantic-search` endpoint removed

### FR-11: RESTful Node Endpoints

Restructure node access to follow REST conventions.

**Validation:**
- `GET /nodes/:id` returns single node
- `GET /nodes/:id/refs` returns references
- `GET /nodes/recent` returns recent nodes
- `POST /nodes/find` accepts search criteria
- Old `/refs` and `/nodes` POST endpoints removed

### FR-12: Unify Webhook Stats Endpoint

Consolidate `/stats` and `/embed-stats` into single `/stats` endpoint.

**Validation:**
- `GET /stats` returns combined stats
- `GET /stats?type=db` returns DB stats only
- `GET /stats?type=embed` returns embedding stats only
- Old `/embed-stats` endpoint removed

### FR-13: RESTful Tags Endpoints

Restructure tag endpoints to follow REST conventions.

**Validation:**
- `GET /tags` lists all supertags
- `GET /tags/top` returns top supertags (was POST `/tags`)
- `GET /tags/:name` returns tag schema
- Old POST `/tags` endpoint removed

### FR-14: Update Webhook Help Endpoint

Update `/help` to document new endpoint structure.

**Validation:**
- `GET /help` shows new endpoints
- `GET /help?format=json` returns JSON documentation
- Examples use new endpoint patterns

## Non-Functional Requirements

- **Performance:** No performance regression; new commands should execute in same time as old equivalents
- **Backwards Compatibility:** This is explicitly a breaking change; old commands will not work
- **Documentation:** README, SKILL.md, and demo scripts must be updated

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| Command | CLI command/subcommand | name, parent, action, options |
| Flag | Command-line option | name, alias, type, default |
| Endpoint | Webhook HTTP endpoint | path, method, params, response |
| SearchType | Type of search operation | fts, semantic, tagged |
| OutputFormat | Result output format | table, json, tana, verbose |

## Command Mapping

| Old Command | New Command | Notes |
|-------------|-------------|-------|
| `query search <q>` | `search <q>` | Default FTS |
| `query search <q> --json` | `search <q> --json` | Same flag |
| `embed search <q>` | `search <q> --semantic` | Flag for type |
| `embed search <q> --show` | `search <q> --semantic --show` | Combine flags |
| `query tagged <tag>` | `search --tag <tag>` | Flag for type |
| `show tagged <tag>` | `search --tag <tag> --show` | Add --show |
| `show node <id>` | `nodes show <id>` | Restructure |
| `show node <id> -d 3` | `nodes show <id> --depth 3` | Long flag |
| `query refs <id>` | `nodes refs <id>` | Restructure |
| `query recent` | `nodes recent` | Restructure |
| `query stats` | `stats` or `stats --db` | Top-level |
| `embed stats` | `stats --embed` | Flag for type |
| `embed filter-stats` | `stats --filter` | Flag for type |
| `query tags` | `tags list` | Restructure |
| `query top-tags` | `tags top` | Restructure |
| `schema show <n>` | `tags show <n>` | Move to tags |
| `schema list` | `schema list` | Unchanged |
| `schema sync` | `schema sync` | Unchanged |

## Webhook Endpoint Mapping

| Old Endpoint | New Endpoint | Method | Notes |
|--------------|--------------|--------|-------|
| `POST /search` | `POST /search` | POST | Add `type`, `show`, `depth` params |
| `POST /semantic-search` | `POST /search` | POST | Use `type: "semantic"` |
| `GET /stats` | `GET /stats` | GET | Add `type` param (db/embed/filter/all) |
| `GET /embed-stats` | `GET /stats?type=embed` | GET | Merged into /stats |
| `POST /tags` | `GET /tags/top` | GET | Changed method, clearer path |
| n/a | `GET /tags` | GET | New: list all tags |
| n/a | `GET /tags/:name` | GET | New: tag schema |
| `POST /nodes` | `POST /nodes/find` | POST | Clearer action path |
| n/a | `GET /nodes/:id` | GET | New: get single node |
| `POST /refs` | `GET /nodes/:id/refs` | GET | RESTful nested resource |
| n/a | `GET /nodes/recent` | GET | New: recent nodes |
| `GET /health` | `GET /health` | GET | Unchanged |
| `GET /workspaces` | `GET /workspaces` | GET | Unchanged |
| `GET /help` | `GET /help` | GET | Updated documentation |

## Success Criteria

- [ ] All 9 user scenarios pass acceptance criteria
- [ ] CLI: Total top-level commands reduced from 13 to 10
- [ ] CLI: All flags normalized across commands
- [ ] Webhook: Endpoints follow RESTful conventions
- [ ] Webhook: Single `/search` endpoint replaces `/search` + `/semantic-search`
- [ ] Webhook: Single `/stats` endpoint replaces `/stats` + `/embed-stats`
- [ ] All tests pass (existing + new)
- [ ] README documentation updated
- [ ] Demo scripts updated and working
- [ ] `supertag --help` shows clean, organized command structure
- [ ] `GET /help` shows new webhook endpoint structure

## Assumptions

- User accepts breaking changes (confirmed: only user)
- Existing test suite covers core functionality that must be preserved
- Commander.js supports the proposed command structure
- Fastify supports the proposed routing structure

## Out of Scope

- MCP tool changes (keep existing tool names for AI compatibility)
- Export CLI changes (`supertag-export` unchanged)
- Database schema changes
- Adding new functionality beyond restructuring
- Authentication/authorization for webhook server
