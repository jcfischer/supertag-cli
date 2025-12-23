---
feature: "Field Values Indexing"
plan: "./plan.md"
status: "pending"
total_tasks: 38
completed: 0
---

# Tasks: Field Values Indexing

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Foundation (Database & Types)

- [ ] **T-1.1** Create field value type definitions [T] [P]
  - File: `src/types/field-values.ts`
  - Test: `tests/types/field-values.test.ts`
  - Description: Define `StoredFieldValue`, `FieldValueResult`, `FieldCondition`, and related interfaces

- [ ] **T-1.2** Add field_values table schema [T] [P]
  - File: `src/db/schema.ts`
  - Test: `tests/db/schema-migration.test.ts`
  - Description: Add `field_values` table DDL with indexes for parent_id, field_name, field_def, created

- [ ] **T-1.3** Add field_values_fts virtual table [T] (depends: T-1.2)
  - File: `src/db/schema.ts`
  - Test: `tests/db/schema-migration.test.ts`
  - Description: Add FTS5 virtual table and sync triggers (ai, ad, au)

- [ ] **T-1.4** Add field_exclusions table [T] [P]
  - File: `src/db/schema.ts`
  - Test: `tests/db/schema-migration.test.ts`
  - Description: Add table for system fields to skip during indexing

- [ ] **T-1.5** Implement schema migration detection [T] (depends: T-1.2, T-1.3, T-1.4)
  - File: `src/db/migrate.ts`
  - Test: `tests/db/schema-migration.test.ts`
  - Description: Detect missing tables and add them safely without dropping existing data

### Group 2: Field Value Extraction

- [ ] **T-2.1** Create field-values module [T] (depends: T-1.1)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Create base module with exports, establish file structure

- [ ] **T-2.2** Implement tuple detection logic [T] (depends: T-2.1)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Detect nodes with `_docType='tuple'` and `_sourceId` property

- [ ] **T-2.3** Implement field name resolution [T] (depends: T-2.1)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Follow `_sourceId` → definition node chain to get human-readable name

- [ ] **T-2.4** Implement value extraction from tuple children [T] (depends: T-2.2)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Extract values from tuple children[1..n], skip label child[0]

- [ ] **T-2.5** Handle multi-value fields [T] (depends: T-2.4)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Support multiple value nodes with `value_order` tracking

- [ ] **T-2.6** Handle nested children [T] (depends: T-2.4)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Concatenate grandchildren into value text, preserve structure

- [ ] **T-2.7** Implement field exclusion filtering [T] (depends: T-2.4, T-1.4)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Check field_exclusions table, skip system fields

- [ ] **T-2.8** Handle empty/null values [T] (depends: T-2.4)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Skip insertion for empty string values, treat as NULL

### Group 3: Indexing Integration

- [ ] **T-3.1** Implement batch insert for field values [T] (depends: T-2.8, T-1.5)
  - File: `src/db/field-values.ts`
  - Test: `tests/db/field-values.test.ts`
  - Description: Efficient batch INSERT using prepared statements

- [ ] **T-3.2** Integrate field extraction into indexer [T] (depends: T-3.1)
  - File: `src/db/indexer.ts`
  - Test: `tests/db/indexer-fields.test.ts`
  - Description: Call field extraction during node processing loop

- [ ] **T-3.3** Clear field_values on full reindex [T] (depends: T-3.2)
  - File: `src/db/indexer.ts`
  - Test: `tests/db/indexer-fields.test.ts`
  - Description: DELETE FROM field_values before full reindex

- [ ] **T-3.4** Update checksum to include field values [T] (depends: T-3.2)
  - File: `src/db/indexer.ts`
  - Test: `tests/db/indexer-fields.test.ts`
  - Description: Include field values in node checksum for change detection

- [ ] **T-3.5** Add field value statistics to sync output [T] (depends: T-3.2)
  - File: `src/db/indexer.ts`
  - Test: `tests/db/indexer-fields.test.ts`
  - Description: Report count of field values indexed in sync summary

### Group 4: Query Engine

- [ ] **T-4.1** Create field-query module [T] (depends: T-3.1)
  - File: `src/query/field-query.ts`
  - Test: `tests/query/field-query.test.ts`
  - Description: Create base module for field value queries

- [ ] **T-4.2** Implement queryFieldValues [T] (depends: T-4.1)
  - File: `src/query/field-query.ts`
  - Test: `tests/query/field-query.test.ts`
  - Description: Query values by field name with date filters, join parent context

- [ ] **T-4.3** Implement searchFieldValuesFTS [T] (depends: T-4.1)
  - File: `src/query/field-query.ts`
  - Test: `tests/query/field-query.test.ts`
  - Description: Full-text search within field values using FTS5

- [ ] **T-4.4** Implement compound query builder [T] (depends: T-4.1)
  - File: `src/query/field-query.ts`
  - Test: `tests/query/field-query.test.ts`
  - Description: Build SQL for tag + multiple field conditions (self-join logic)

- [ ] **T-4.5** Implement compoundQuery function [T] (depends: T-4.4)
  - File: `src/query/field-query.ts`
  - Test: `tests/query/field-query.test.ts`
  - Description: Execute compound queries with pagination and sorting

- [ ] **T-4.6** Add support for comparison operators [T] (depends: T-4.4)
  - File: `src/query/field-query.ts`
  - Test: `tests/query/field-query.test.ts`
  - Description: Implement eq, contains, lt, gt operators in condition builder

### Group 5: MCP Tools

- [ ] **T-5.1** Enhance tana_node to include field values [T] (depends: T-4.2)
  - File: `src/mcp/tools/node.ts`
  - Test: `tests/mcp/node-fields.test.ts`
  - Description: Query field_values table instead of parsing raw_data on each request

- [ ] **T-5.2** Add field parameter to tana_search [T] (depends: T-4.3)
  - File: `src/mcp/tools/search.ts`
  - Test: `tests/mcp/search-fields.test.ts`
  - Description: Optional field parameter to constrain FTS to specific field

- [ ] **T-5.3** Create tana_query MCP tool [T] (depends: T-4.5)
  - File: `src/mcp/tools/query.ts`
  - Test: `tests/mcp/query-tool.test.ts`
  - Description: New tool for compound queries with tag + field conditions

- [ ] **T-5.4** Create tana_field_values MCP tool [T] (depends: T-4.2)
  - File: `src/mcp/tools/field-values.ts`
  - Test: `tests/mcp/field-values-tool.test.ts`
  - Description: New tool to retrieve all values of a specific field

- [ ] **T-5.5** Add MCP schemas for new tools [T] (depends: T-5.3, T-5.4)
  - File: `src/mcp/schemas.ts`
  - Test: (covered by tool tests)
  - Description: Zod schemas for tana_query and tana_field_values input validation

- [ ] **T-5.6** Register new MCP tools [T] (depends: T-5.3, T-5.4, T-5.5)
  - File: `src/mcp/index.ts`
  - Test: `tests/mcp/registration.test.ts`
  - Description: Add handlers for tana_query and tana_field_values to server

### Group 6: CLI Commands

- [ ] **T-6.1** Create fields command group [T] (depends: T-4.2)
  - File: `src/commands/fields.ts`
  - Test: `tests/commands/fields.test.ts`
  - Description: Set up `supertag fields` command with subcommands

- [ ] **T-6.2** Implement fields list command [T] (depends: T-6.1)
  - File: `src/commands/fields.ts`
  - Test: `tests/commands/fields.test.ts`
  - Description: Show all field names with usage counts from field_values table

- [ ] **T-6.3** Implement fields values command [T] (depends: T-6.1)
  - File: `src/commands/fields.ts`
  - Test: `tests/commands/fields.test.ts`
  - Description: `supertag fields values <name>` - get values for a field with filters

- [ ] **T-6.4** Implement fields search command [T] (depends: T-4.3)
  - File: `src/commands/fields.ts`
  - Test: `tests/commands/fields.test.ts`
  - Description: `supertag fields search <query>` - FTS search in field values

- [ ] **T-6.5** Create query command [T] (depends: T-4.5)
  - File: `src/commands/query.ts`
  - Test: `tests/commands/query.test.ts`
  - Description: `supertag query <tag> --field "name=value"` compound query CLI

- [ ] **T-6.6** Register new CLI commands [T] (depends: T-6.1, T-6.5)
  - File: `src/index.ts`
  - Test: `tests/cli/registration.test.ts`
  - Description: Add fields and query commands to main CLI entry point

### Group 7: Embedding Enhancement

- [ ] **T-7.1** Create context-builder module [T] (depends: T-3.2)
  - File: `src/embeddings/context-builder.ts`
  - Test: `tests/embeddings/context-builder.test.ts`
  - Description: Build embedding text with field values in `[FieldName]: value` format

- [ ] **T-7.2** Integrate field context into embedding generation [T] (depends: T-7.1)
  - File: `src/embeddings/generator.ts`
  - Test: `tests/embeddings/generator-fields.test.ts`
  - Description: Include field values when generating node embeddings

- [ ] **T-7.3** Add --include-fields flag to embed command [T] (depends: T-7.2)
  - File: `src/commands/embed.ts`
  - Test: `tests/commands/embed-fields.test.ts`
  - Description: Optional flag to include field context in embeddings

### Group 8: Documentation & Polish

- [ ] **T-8.1** Update SKILL.md with new tools (depends: T-5.6, T-6.6)
  - File: `SKILL.md`
  - Description: Add tana_query, tana_field_values, fields commands documentation

- [ ] **T-8.2** Update README.md with examples (depends: T-8.1)
  - File: `README.md`
  - Description: Add field query examples, compound query syntax

- [ ] **T-8.3** Write integration tests [T] (depends: T-5.6, T-6.6)
  - File: `tests/integration/field-indexing.test.ts`
  - Test: (self)
  - Description: End-to-end tests covering full pipeline from export to query

## Dependency Graph

```
                                FOUNDATION
                    ┌────────────────────────────────────┐
                    │                                    │
                T-1.1 ◄─┐        T-1.2 ◄──┬── T-1.4     │
                  │     │          │      │             │
                  │     │          │      │             │
                  │     │          ▼      │             │
                  │     │        T-1.3    │             │
                  │     │          │      │             │
                  │     │          ▼      ▼             │
                  │     │        T-1.5 ◄──┘             │
                  │     │          │                    │
                  └─────┼──────────┼────────────────────┘
                        │          │
                    ┌───┴──────────┴───┐
                    │                  │
                    ▼   EXTRACTION     │
                  T-2.1                │
                    │                  │
          ┌─────────┼─────────┐        │
          ▼         ▼         ▼        │
        T-2.2     T-2.3     (T-2.7)◄───┤
          │                   ▲        │
          ▼                   │        │
        T-2.4 ────────────────┤        │
          │                   │        │
    ┌─────┼─────┬─────────────┤        │
    ▼     ▼     ▼             │        │
  T-2.5 T-2.6 T-2.8           │        │
    │     │     │             │        │
    └─────┴─────┴─────────────┤        │
                              │        │
                    ┌─────────┴────────┘
                    │
                    ▼   INDEXING
                  T-3.1
                    │
                    ▼
                  T-3.2
                    │
          ┌────────┼────────┬────────┐
          ▼        ▼        ▼        │
        T-3.3    T-3.4    T-3.5      │
                                     │
                    ┌────────────────┘
                    │
                    ▼   QUERY ENGINE
                  T-4.1
                    │
          ┌────────┼────────┐
          ▼        ▼        ▼
        T-4.2    T-4.3    T-4.4
          │        │        │
          │        │        ▼
          │        │      T-4.5
          │        │        │
          │        │        ▼
          │        │      T-4.6
          │        │
    ┌─────┼────────┼───────────────────────────┐
    │     │        │                           │
    │  ┌──┴────┬───┴────┬───────┬───────┐     │
    │  ▼       ▼        ▼       ▼       ▼     │
    │ T-5.1  T-5.2    T-5.3   T-5.4   T-7.1   │  MCP & EMBED
    │                   │       │       │     │
    │                   └───┬───┘       ▼     │
    │                       ▼         T-7.2   │
    │                     T-5.5         │     │
    │                       │           ▼     │
    │                       ▼         T-7.3   │
    │                     T-5.6               │
    │                                         │
    │  ┌────────────────────────────────────┐ │
    │  │                                    │ │
    │  ▼   CLI                              │ │
    │ T-6.1                                 │ │
    │   │                                   │ │
    │   ├───────┬───────┬───────┐           │ │
    │   ▼       ▼       ▼       │           │ │
    │ T-6.2   T-6.3   T-6.4     │           │ │
    │   │       │       │       │           │ │
    │   └───────┴───────┴───────┤           │ │
    │                           │           │ │
    │                 T-6.5 ◄───┤           │ │
    │                   │       │           │ │
    │                   ▼       │           │ │
    │                 T-6.6 ◄───┘           │ │
    │                                       │ │
    └───────────────────────────────────────┘ │
                                              │
                    ┌─────────────────────────┘
                    │
                    ▼   DOCUMENTATION
                  T-8.1 ◄── T-5.6, T-6.6
                    │
                    ▼
                  T-8.2
                    │
                    ▼
                  T-8.3
```

## Execution Order

1. **Parallel batch 1:** T-1.1, T-1.2, T-1.4 (Foundation types and schema)
2. **Sequential:** T-1.3 (FTS table after base table)
3. **Sequential:** T-1.5 (Migration after all schema defined)
4. **Sequential:** T-2.1 (Field values module base)
5. **Parallel batch 2:** T-2.2, T-2.3 (Tuple detection, name resolution)
6. **Sequential:** T-2.4 (Value extraction)
7. **Parallel batch 3:** T-2.5, T-2.6, T-2.7, T-2.8 (Multi-value, nested, exclusion, empty)
8. **Sequential:** T-3.1 (Batch insert)
9. **Sequential:** T-3.2 (Indexer integration)
10. **Parallel batch 4:** T-3.3, T-3.4, T-3.5 (Reindex clear, checksum, stats)
11. **Sequential:** T-4.1 (Query engine base)
12. **Parallel batch 5:** T-4.2, T-4.3, T-4.4 (Query functions)
13. **Sequential:** T-4.5, T-4.6 (Compound query, operators)
14. **Parallel batch 6:** T-5.1, T-5.2, T-5.3, T-5.4, T-6.1, T-7.1 (MCP tools, CLI, embeddings)
15. **Sequential in each branch:**
    - MCP: T-5.5 → T-5.6
    - CLI: T-6.2, T-6.3, T-6.4 → T-6.5 → T-6.6
    - Embed: T-7.2 → T-7.3
16. **Sequential:** T-8.1 → T-8.2 → T-8.3 (Documentation and integration tests)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | pending | - | - | Type definitions |
| T-1.2 | pending | - | - | field_values table |
| T-1.3 | pending | - | - | FTS5 virtual table |
| T-1.4 | pending | - | - | field_exclusions table |
| T-1.5 | pending | - | - | Migration detection |
| T-2.1 | pending | - | - | Module setup |
| T-2.2 | pending | - | - | Tuple detection |
| T-2.3 | pending | - | - | Name resolution |
| T-2.4 | pending | - | - | Value extraction |
| T-2.5 | pending | - | - | Multi-value support |
| T-2.6 | pending | - | - | Nested children |
| T-2.7 | pending | - | - | Field exclusions |
| T-2.8 | pending | - | - | Empty values |
| T-3.1 | pending | - | - | Batch insert |
| T-3.2 | pending | - | - | Indexer integration |
| T-3.3 | pending | - | - | Reindex clear |
| T-3.4 | pending | - | - | Checksum update |
| T-3.5 | pending | - | - | Stats output |
| T-4.1 | pending | - | - | Query module |
| T-4.2 | pending | - | - | queryFieldValues |
| T-4.3 | pending | - | - | FTS search |
| T-4.4 | pending | - | - | Compound builder |
| T-4.5 | pending | - | - | compoundQuery |
| T-4.6 | pending | - | - | Operators |
| T-5.1 | pending | - | - | tana_node enhance |
| T-5.2 | pending | - | - | tana_search field |
| T-5.3 | pending | - | - | tana_query tool |
| T-5.4 | pending | - | - | tana_field_values |
| T-5.5 | pending | - | - | MCP schemas |
| T-5.6 | pending | - | - | MCP registration |
| T-6.1 | pending | - | - | fields command |
| T-6.2 | pending | - | - | fields list |
| T-6.3 | pending | - | - | fields values |
| T-6.4 | pending | - | - | fields search |
| T-6.5 | pending | - | - | query command |
| T-6.6 | pending | - | - | CLI registration |
| T-7.1 | pending | - | - | context-builder |
| T-7.2 | pending | - | - | Generator integration |
| T-7.3 | pending | - | - | --include-fields flag |
| T-8.1 | pending | - | - | SKILL.md update |
| T-8.2 | pending | - | - | README.md update |
| T-8.3 | pending | - | - | Integration tests |

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

The longest dependency chain (critical path) is:

```
T-1.2 → T-1.3 → T-1.5 → T-3.1 → T-3.2 → T-4.1 → T-4.4 → T-4.5 → T-5.3 → T-5.5 → T-5.6 → T-8.1 → T-8.2 → T-8.3
```

**14 sequential tasks** on critical path. Parallel opportunities can reduce wall-clock time significantly.
