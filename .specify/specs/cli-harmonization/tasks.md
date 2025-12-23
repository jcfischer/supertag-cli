---
feature: "CLI Harmonization"
plan: "./plan.md"
status: "in_progress"
total_tasks: 28
completed: 17
---

# Tasks: CLI Harmonization

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Types & Helpers)

- [x] **T-1.1** Add shared types to types.ts [T] [P] ✅ DONE
  - File: `src/types.ts`
  - Test: `tests/types.test.ts`
  - Description: Add `StandardOptions`, `SearchType`, `StatsType` interfaces

- [x] **T-1.2** Create shared command helpers [T] [P] ✅ DONE
  - File: `src/commands/helpers.ts`
  - Test: `tests/commands/helpers.test.ts`
  - Description: Extract `resolveDbPath()`, `formatOutput()`, standard option registration

### Group 2: New CLI Commands

- [x] **T-2.1** Create unified search command [T] [P] (depends: T-1.1, T-1.2) ✅ DONE
  - File: `src/commands/search.ts`
  - Test: `tests/commands/search.test.ts`
  - Description: `supertag search <query>` with `--semantic`, `--tag`, `--show`, `--depth` flags

- [x] **T-2.2** Create nodes command group [T] [P] (depends: T-1.1, T-1.2) ✅ DONE
  - File: `src/commands/nodes.ts`
  - Test: `tests/commands/nodes.test.ts`
  - Description: `supertag nodes show|refs|recent` subcommands

- [x] **T-2.3** Create tags command group [T] [P] (depends: T-1.1, T-1.2) ✅ DONE
  - File: `src/commands/tags.ts`
  - Test: `tests/commands/tags.test.ts`
  - Description: `supertag tags list|top|show|search` subcommands

- [x] **T-2.4** Create unified stats command [T] [P] (depends: T-1.1, T-1.2) ✅ DONE
  - File: `src/commands/stats.ts`
  - Test: `tests/commands/stats.test.ts`
  - Description: `supertag stats` with `--db`, `--embed`, `--filter` flags

### Group 3: Wire New CLI Commands

- [x] **T-3.1** Register search command in index.ts [T] (depends: T-2.1) ✅ DONE
  - File: `src/index.ts`
  - Test: `tests/commands/cli-wiring.test.ts`
  - Description: Add search command alongside existing commands

- [x] **T-3.2** Register nodes command in index.ts [T] (depends: T-2.2) ✅ DONE
  - File: `src/index.ts`
  - Test: `tests/commands/cli-wiring.test.ts`
  - Description: Add nodes command alongside existing commands

- [x] **T-3.3** Register tags command in index.ts [T] (depends: T-2.3) ✅ DONE
  - File: `src/index.ts`
  - Test: `tests/commands/cli-wiring.test.ts`
  - Description: Add tags command alongside existing commands

- [x] **T-3.4** Register stats command in index.ts [T] (depends: T-2.4) ✅ DONE
  - File: `src/index.ts`
  - Test: `tests/commands/cli-wiring.test.ts`
  - Description: Add stats command alongside existing commands

### Group 4: Webhook Server Refactor

- [ ] **T-4.1** Create unified /search endpoint [T] [P] (depends: T-1.1)
  - File: `src/server/tana-webhook-server.ts`
  - Test: `tests/server/search-endpoint.test.ts`
  - Description: `POST /search` with `type` param (fts|semantic|tagged)

- [ ] **T-4.2** Create RESTful /nodes endpoints [T] [P] (depends: T-1.1)
  - File: `src/server/tana-webhook-server.ts`
  - Test: `tests/server/nodes-endpoint.test.ts`
  - Description: `GET /nodes/:id`, `GET /nodes/:id/refs`, `GET /nodes/recent`, `POST /nodes/find`

- [ ] **T-4.3** Create unified /stats endpoint [T] [P] (depends: T-1.1)
  - File: `src/server/tana-webhook-server.ts`
  - Test: `tests/server/stats-endpoint.test.ts`
  - Description: `GET /stats` with `type` query param (all|db|embed|filter)

- [ ] **T-4.4** Create RESTful /tags endpoints [T] [P] (depends: T-1.1)
  - File: `src/server/tana-webhook-server.ts`
  - Test: `tests/server/tags-endpoint.test.ts`
  - Description: `GET /tags`, `GET /tags/top`, `GET /tags/:name`

- [ ] **T-4.5** Update /help endpoint documentation [T] (depends: T-4.1, T-4.2, T-4.3, T-4.4)
  - File: `src/server/tana-webhook-server.ts`
  - Test: `tests/server/help-endpoint.test.ts`
  - Description: Update help text to document new endpoint structure

### Group 5: Remove Old Commands (Breaking Changes)

- [ ] **T-5.1** Remove registerQueryCommands from index.ts [T] (depends: T-3.1, T-3.2, T-3.3, T-3.4)
  - File: `src/index.ts`
  - Test: `tests/cli-integration.test.ts`
  - Description: Remove old query command registration

- [ ] **T-5.2** Delete query.ts command file (depends: T-5.1)
  - File: `src/commands/query.ts` (DELETE)
  - Test: N/A (verify commands removed)
  - Description: Remove deprecated query command file

- [ ] **T-5.3** Refactor show.ts - keep helpers only [T] (depends: T-5.1)
  - File: `src/commands/show.ts`
  - Test: `tests/commands/show.test.ts`
  - Description: Remove command registration, keep helper functions for node display

- [ ] **T-5.4** Refactor embed.ts - remove search command [T] (depends: T-3.1)
  - File: `src/commands/embed.ts`
  - Test: `tests/commands/embed.test.ts`
  - Description: Remove `embed search` (now `search --semantic`), keep generate/config/maintain

- [ ] **T-5.5** Remove old webhook endpoints [T] (depends: T-4.5)
  - File: `src/server/tana-webhook-server.ts`
  - Test: `tests/server/webhook.test.ts`
  - Description: Remove `/semantic-search`, `/embed-stats`, old `POST /tags`, `POST /nodes`, `POST /refs`

### Group 6: Schema Command Modernization

- [ ] **T-6.1** Convert schema to Commander subcommands [T] (depends: T-1.2)
  - File: `src/commands/schema.ts`
  - Test: `tests/commands/schema.test.ts`
  - Description: Convert from manual arg parsing to proper Commander subcommands

### Group 7: Documentation

- [ ] **T-7.1** Update CLI help text (depends: T-5.1, T-5.2, T-5.3, T-5.4)
  - File: `src/index.ts`, all command files
  - Test: N/A (manual verification)
  - Description: Update all command descriptions and examples

- [ ] **T-7.2** Update README.md (depends: T-7.1)
  - File: `README.md`
  - Test: N/A (documentation)
  - Description: Document new command structure, remove old examples

- [ ] **T-7.3** Update SKILL.md (depends: T-7.1)
  - File: `SKILL.md`
  - Test: N/A (documentation)
  - Description: Update PAI skill documentation for new commands

- [ ] **T-7.4** Update demo scripts (depends: T-7.1)
  - Files: `~/work/supertag-demos/*.md`
  - Test: N/A (documentation)
  - Description: Update all demo scripts to use new command structure

- [ ] **T-7.5** Update CHANGELOG.md (depends: T-7.1)
  - File: `CHANGELOG.md`
  - Test: N/A (documentation)
  - Description: Document breaking changes and migration guide

- [ ] **T-7.6** Update public changelog (depends: T-7.5)
  - File: `~/work/web/invisible-store/tana/CHANGELOG.md`
  - Test: N/A (documentation)
  - Description: Update customer-facing changelog

## Dependency Graph

```
Group 1 (Foundation):
T-1.1 ──┬──────────────────────────────────────────────────────┐
T-1.2 ──┤                                                      │
        │                                                      │
Group 2 (New CLI Commands):                                    │
        ├──> T-2.1 ──> T-3.1 ──┐                               │
        ├──> T-2.2 ──> T-3.2 ──┤                               │
        ├──> T-2.3 ──> T-3.3 ──┼──> T-5.1 ──> T-5.2            │
        ├──> T-2.4 ──> T-3.4 ──┘      │                        │
        │                             ├──> T-5.3               │
        │                             └──> T-7.1 ──> T-7.2     │
        │                                    │        T-7.3    │
        │                                    │        T-7.4    │
        │                                    │        T-7.5 ──> T-7.6
        └──> T-6.1                           │                 │
                                             │                 │
Group 4 (Webhook):                           │                 │
T-1.1 ──┬──> T-4.1 ──┐                       │                 │
        ├──> T-4.2 ──┼──> T-4.5 ──> T-5.5    │                 │
        ├──> T-4.3 ──┤                       │                 │
        └──> T-4.4 ──┘                       │                 │
                                             │                 │
T-3.1 ──────────────────────> T-5.4 ─────────┘                 │
```

## Execution Order

### Parallel Batch 1 (Foundation)
- T-1.1: Add shared types
- T-1.2: Create command helpers

### Parallel Batch 2 (New Commands + Webhook Endpoints)
- T-2.1: Create search command
- T-2.2: Create nodes command
- T-2.3: Create tags command
- T-2.4: Create stats command
- T-4.1: Create /search endpoint
- T-4.2: Create /nodes endpoints
- T-4.3: Create /stats endpoint
- T-4.4: Create /tags endpoints
- T-6.1: Convert schema to subcommands

### Parallel Batch 3 (Wire Commands)
- T-3.1: Register search
- T-3.2: Register nodes
- T-3.3: Register tags
- T-3.4: Register stats
- T-4.5: Update /help endpoint

### Sequential: Remove Old (Breaking Changes)
- T-5.1: Remove registerQueryCommands
- T-5.2: Delete query.ts
- T-5.3: Refactor show.ts
- T-5.4: Refactor embed.ts
- T-5.5: Remove old webhook endpoints

### Parallel Batch 4 (Documentation)
- T-7.1: Update CLI help text
- T-7.2: Update README.md
- T-7.3: Update SKILL.md
- T-7.4: Update demo scripts
- T-7.5: Update CHANGELOG.md

### Final
- T-7.6: Update public changelog

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | ✅ done | 2025-12-22 | 2025-12-22 | Types added |
| T-1.2 | ✅ done | 2025-12-22 | 2025-12-22 | Helpers created |
| T-2.1 | ✅ done | 2025-12-22 | 2025-12-22 | search.ts created |
| T-2.2 | ✅ done | 2025-12-22 | 2025-12-22 | nodes.ts created |
| T-2.3 | ✅ done | 2025-12-22 | 2025-12-22 | tags.ts created |
| T-2.4 | ✅ done | 2025-12-23 | 2025-12-23 | stats.ts created |
| T-3.1 | ✅ done | 2025-12-23 | 2025-12-23 | Wired in index.ts |
| T-3.2 | ✅ done | 2025-12-23 | 2025-12-23 | Wired in index.ts |
| T-3.3 | ✅ done | 2025-12-23 | 2025-12-23 | Wired in index.ts |
| T-3.4 | ✅ done | 2025-12-23 | 2025-12-23 | Wired in index.ts |
| T-4.1 | pending | - | - | /search |
| T-4.2 | pending | - | - | /nodes/* |
| T-4.3 | pending | - | - | /stats |
| T-4.4 | pending | - | - | /tags/* |
| T-4.5 | pending | - | - | /help |
| T-5.1 | pending | - | - | Remove query reg |
| T-5.2 | pending | - | - | Delete query.ts |
| T-5.3 | pending | - | - | Refactor show.ts |
| T-5.4 | pending | - | - | Refactor embed.ts |
| T-5.5 | pending | - | - | Remove old endpoints |
| T-6.1 | ✅ done | 2025-12-23 | 2025-12-23 | Schema modernize |
| T-7.1 | ✅ done | 2025-12-23 | 2025-12-23 | Help text updated |
| T-7.2 | ✅ done | 2025-12-23 | 2025-12-23 | README |
| T-7.3 | ⏭️ skip | - | - | SKILL.md (not in project) |
| T-7.4 | ✅ done | 2025-12-23 | 2025-12-23 | Demos |
| T-7.5 | ✅ done | 2025-12-23 | 2025-12-23 | CHANGELOG |
| T-7.6 | ✅ done | 2025-12-23 | 2025-12-23 | Public changelog |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Critical Path

The longest dependency chain determines minimum implementation time:

```
T-1.1 → T-2.1 → T-3.1 → T-5.1 → T-7.1 → T-7.5 → T-7.6
```

7 sequential tasks on the critical path. However, significant parallelization is possible in Batches 1, 2, and 4.
