---
feature: "System Field Discovery"
plan: "./plan.md"
status: "pending"
total_tasks: 18
completed: 0
---

# Tasks: System Field Discovery

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Infrastructure)

- [ ] **T-1.1** Define SYSTEM_FIELD_METADATA constant [T] [P]
  - File: `src/db/system-fields.ts` (new)
  - Test: `tests/db/system-fields.test.ts` (new)
  - Description: Create constant mapping SYS_A* IDs to metadata (name, normalizedName, dataType)

- [ ] **T-1.2** Add SystemFieldMetadata type [P]
  - File: `src/types/supertag-metadata.ts`
  - Test: N/A (type-only change)
  - Description: Add TypeScript interface for system field metadata

- [ ] **T-1.3** Create system_field_sources table migration [T] [P]
  - File: `src/db/migrate.ts`
  - Test: `tests/db/system-fields.test.ts`
  - Description: Add migration function to create system_field_sources table with indexes

- [ ] **T-1.4** Add system flag to InheritedField type
  - File: `src/types/supertag-metadata.ts`
  - Test: N/A (type-only change)
  - Description: Add optional `system?: boolean` flag to InheritedField interface

### Group 2: Discovery (Data Extraction)

- [ ] **T-2.1** Implement discoverSystemFieldSources() [T] (depends: T-1.1)
  - File: `src/db/system-fields.ts`
  - Test: `tests/db/system-fields.test.ts`
  - Description: Scan tagDef documents to find which ones define SYS_A* fields

- [ ] **T-2.2** Implement insertSystemFieldSources() [T] (depends: T-1.3)
  - File: `src/db/system-fields.ts`
  - Test: `tests/db/system-fields.test.ts`
  - Description: Insert discovered mappings into system_field_sources table

- [ ] **T-2.3** Call discovery during indexer sync [T] (depends: T-2.1, T-2.2)
  - File: `src/db/indexer.ts`
  - Test: `tests/db/system-fields.test.ts`
  - Description: Integrate system field discovery into indexTagDefs() function

- [ ] **T-2.4** Integration test with real export data [T] (depends: T-2.3)
  - File: `tests/db/system-fields.test.ts`
  - Test: Same file
  - Description: Test discovery finds SYS_A90, SYS_A142 sources in actual workspace export

### Group 3: Retrieval (Query Enhancement)

- [ ] **T-3.1** Add getSystemFieldSourceTags() method [T] (depends: T-2.3)
  - File: `src/services/supertag-metadata-service.ts`
  - Test: `tests/services/supertag-metadata-service.test.ts`
  - Description: Query which tagDefs define a given system field ID

- [ ] **T-3.2** Add getSystemFieldsForTag() method [T] (depends: T-3.1)
  - File: `src/services/supertag-metadata-service.ts`
  - Test: `tests/services/supertag-metadata-service.test.ts`
  - Description: Get all system fields available to a tag based on its inheritance chain

- [ ] **T-3.3** Modify getAllFields() to include system fields [T] (depends: T-3.2, T-1.4)
  - File: `src/services/supertag-metadata-service.ts`
  - Test: `tests/services/supertag-metadata-service.test.ts`
  - Description: Merge system fields into getAllFields() result with `system: true` flag

- [ ] **T-3.4** Test user-defined fields take precedence [T] (depends: T-3.3)
  - File: `tests/services/supertag-metadata-service.test.ts`
  - Test: Same file
  - Description: Verify that if a tag defines its own "Date" field, system Date is excluded

- [ ] **T-3.5** Test non-inheriting tags get no system fields [T] (depends: T-3.3)
  - File: `tests/services/supertag-metadata-service.test.ts`
  - Test: Same file
  - Description: Verify tags without system field ancestors don't get system fields

### Group 4: Integration (Consumers)

- [ ] **T-4.1** Update tana_supertag_info response [T] (depends: T-3.3)
  - File: `src/mcp/tools/supertag-info.ts`
  - Test: `tests/mcp/supertag-info.test.ts`
  - Description: Include `system: true` flag in field response for MCP consumers

- [ ] **T-4.2** Update CLI tags fields command [T] (depends: T-3.3)
  - File: `src/commands/schema.ts`
  - Test: `tests/commands/schema.test.ts`
  - Description: Show system fields with indicator (e.g., [sys]) in CLI output

- [ ] **T-4.3** Verify node-builder works with system fields [T] (depends: T-4.1)
  - File: `tests/services/node-builder.test.ts`
  - Test: Same file
  - Description: Test that creating nodes with system field values (e.g., Attendees) works

- [ ] **T-4.4** E2E test: create meeting with Attendees [T] (depends: T-4.3)
  - File: `tests/e2e/system-fields.test.ts` (new)
  - Test: Same file
  - Description: Full flow test: tana_supertag_info shows Attendees, tana_create uses it

- [ ] **T-4.5** Update documentation (depends: T-4.4)
  - Files: `CHANGELOG.md`
  - Description: Document system field discovery feature

## Dependency Graph

```
                    ┌───────────────────────────────────────────────────────┐
                    │                    GROUP 1: Foundation                 │
                    └───────────────────────────────────────────────────────┘

                    T-1.1 ─────────────┐
                    (METADATA)         │
                                       │
                    T-1.2 ─────────────┼─────────────────────────────┐
                    (Types)            │                             │
                                       │                             │
                    T-1.3 ─────────────┼──────────┐                  │
                    (Migration)        │          │                  │
                                       │          │                  │
                    T-1.4 ─────────────┼──────────┼──────────────────┼───┐
                    (Type flag)        │          │                  │   │
                                       ▼          ▼                  │   │
                    ┌───────────────────────────────────────────────────────┐
                    │                    GROUP 2: Discovery                  │
                    └───────────────────────────────────────────────────────┘

                              T-2.1 ─────────────┐
                              (discover)         │
                                                 │
                              T-2.2 ─────────────┤
                              (insert)           │
                                                 ▼
                                          T-2.3 ──────────┐
                                          (indexer)       │
                                                          ▼
                                                   T-2.4
                                                   (integration test)
                                                          │
                    ┌─────────────────────────────────────┼─────────────────┐
                    │                    GROUP 3: Retrieval                  │
                    └─────────────────────────────────────┼─────────────────┘
                                                          ▼
                                          T-3.1 ──────────┐
                                          (getSources)    │
                                                          ▼
                                          T-3.2 ──────────┐
                                          (getForTag)     │
                                                          ▼
                                          T-3.3 ◄─────────┘
                                          (getAllFields)
                                               │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                           T-3.4            T-3.5
                           (precedence)    (no inherit)
                                               │
                    ┌──────────────────────────┼────────────────────────────┐
                    │                    GROUP 4: Integration                │
                    └──────────────────────────┼────────────────────────────┘
                                               ▼
                              ┌────────────────┼────────────────┐
                              ▼                ▼                │
                           T-4.1            T-4.2              │
                           (MCP)           (CLI)               │
                              │                                │
                              ▼                                │
                           T-4.3 ◄─────────────────────────────┘
                           (node-builder)
                              │
                              ▼
                           T-4.4
                           (E2E)
                              │
                              ▼
                           T-4.5
                           (docs)
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2, T-1.3, T-1.4 (all independent)
2. **Parallel batch 2:** T-2.1 (depends: T-1.1), T-2.2 (depends: T-1.3)
3. **Sequential:** T-2.3 (after batch 2)
4. **Sequential:** T-2.4 (after T-2.3)
5. **Sequential:** T-3.1 (after T-2.3)
6. **Sequential:** T-3.2 (after T-3.1)
7. **Sequential:** T-3.3 (after T-3.2, T-1.4)
8. **Parallel batch 3:** T-3.4, T-3.5 (both after T-3.3)
9. **Parallel batch 4:** T-4.1, T-4.2 (both after T-3.3)
10. **Sequential:** T-4.3 (after T-4.1)
11. **Sequential:** T-4.4 (after T-4.3)
12. **Sequential:** T-4.5 (after T-4.4)

**Critical Path:** T-1.1 → T-2.1 → T-2.3 → T-3.1 → T-3.2 → T-3.3 → T-4.1 → T-4.3 → T-4.4 → T-4.5

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | SYSTEM_FIELD_METADATA constant |
| T-1.2 | pending | - | - | SystemFieldMetadata type |
| T-1.3 | pending | - | - | system_field_sources table |
| T-1.4 | pending | - | - | system flag on InheritedField |
| T-2.1 | pending | - | - | discoverSystemFieldSources() |
| T-2.2 | pending | - | - | insertSystemFieldSources() |
| T-2.3 | pending | - | - | Integrate into indexer |
| T-2.4 | pending | - | - | Integration test |
| T-3.1 | pending | - | - | getSystemFieldSourceTags() |
| T-3.2 | pending | - | - | getSystemFieldsForTag() |
| T-3.3 | pending | - | - | Enhance getAllFields() |
| T-3.4 | pending | - | - | Precedence test |
| T-3.5 | pending | - | - | Non-inheriting test |
| T-4.1 | pending | - | - | MCP response update |
| T-4.2 | pending | - | - | CLI output update |
| T-4.3 | pending | - | - | node-builder verification |
| T-4.4 | pending | - | - | E2E test |
| T-4.5 | pending | - | - | Documentation |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun run test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |
