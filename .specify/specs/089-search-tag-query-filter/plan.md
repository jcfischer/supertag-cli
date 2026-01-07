---
feature: "Search Tag Query Filter"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Search Tag Query Filter

## Architecture Overview

Fix the `search` command to filter tagged results by query string. Currently, when `--tag` is specified, the query is ignored. The fix propagates the query through the call chain and adds name filtering.

```
CLI: supertag search "Bikepacking" --tag topic
                     |
                     v
        ┌─────────────────────────┐
        │  createSearchCommand()  │
        │   - Parse query + tag   │
        └────────────┬────────────┘
                     │ query, tagname
                     v
        ┌─────────────────────────┐
        │  handleTaggedSearch()   │
        │   - Add query param     │◄── FR-1: Pass query
        │   - Filter by name      │◄── FR-2: Name filter
        └────────────┬────────────┘
                     │
                     v
        ┌─────────────────────────┐
        │  findNodesByTag()       │
        │   - Add nameContains    │◄── SQL WHERE clause
        └─────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Existing codebase |
| Runtime | Bun | Existing codebase |
| Database | SQLite | Existing, use LIKE for filtering |

## Constitutional Compliance

- [x] **CLI-First:** Existing CLI interface, adding query filtering
- [x] **Library-First:** Core logic in `TanaQueryEngine.findNodesByTag()`
- [x] **Test-First:** TDD - write failing tests first
- [x] **Deterministic:** SQL LIKE query, no AI/probabilistic behavior
- [x] **Code Before Prompts:** Pure code change, no prompts involved

## Implementation Strategy

### Phase 1: CLI Layer (src/commands/search.ts)

1. **Modify `handleTaggedSearch` signature**
   - Add `query?: string` parameter
   - Pass query from command handler

2. **Modify case "tagged" call site (line 162)**
   ```typescript
   // Before:
   await handleTaggedSearch(options.tag!, options, dbPath);

   // After:
   await handleTaggedSearch(options.tag!, query, options, dbPath);
   ```

### Phase 2: Query Engine (src/query/tana-query-engine.ts)

1. **Extend `findNodesByTag` options**
   ```typescript
   async findNodesByTag(
     tagName: string,
     options?: {
       limit?: number;
       orderBy?: "created" | "updated";
       nameContains?: string;  // NEW: case-insensitive filter
       // ... existing date range options
     }
   ): Promise<Node[]>
   ```

2. **Add SQL WHERE clause**
   ```sql
   -- When nameContains is provided:
   AND LOWER(n.name) LIKE '%' || LOWER(?) || '%'
   ```

### Phase 3: MCP Tool (src/mcp/tools/tagged.ts + schemas.ts)

1. **Update `taggedSchema` (schemas.ts line 73-88)**
   ```typescript
   export const taggedSchema = z.object({
     tagname: z.string().min(1),
     query: z.string().optional()  // NEW
       .describe('Filter results to nodes whose name contains this text (case-insensitive)'),
     // ... existing fields
   });
   ```

2. **Update `tagged()` function**
   - Pass `input.query` to `findNodesByTag` as `nameContains`

## File Structure

```
src/
├── commands/
│   └── search.ts           # [MODIFY] Pass query to handleTaggedSearch
├── query/
│   └── tana-query-engine.ts  # [MODIFY] Add nameContains to findNodesByTag
└── mcp/
    ├── schemas.ts          # [MODIFY] Add query to taggedSchema
    └── tools/
        └── tagged.ts       # [MODIFY] Pass query to engine

tests/
├── unit/
│   └── search-tag-query.test.ts  # [NEW] Unit tests for name filtering
└── e2e/
    └── search-tag-query.e2e.test.ts  # [NEW] E2E tests
```

## Test Plan

### Unit Tests (TDD)

1. **`findNodesByTag` with nameContains**
   ```typescript
   it('should filter by nameContains (case-insensitive)', async () => {
     // Setup: Create nodes with tag "topic": "Velo", "Bikepacking", "Running"
     const results = await engine.findNodesByTag('topic', { nameContains: 'velo' });
     expect(results.length).toBe(1);
     expect(results[0].name).toBe('Velo');
   });
   ```

2. **`findNodesByTag` without nameContains (regression)**
   ```typescript
   it('should return all nodes when nameContains not provided', async () => {
     const results = await engine.findNodesByTag('topic');
     expect(results.length).toBe(3);  // All topics
   });
   ```

### E2E Tests

1. **CLI with query + tag**
   ```typescript
   it('should filter tagged results by query', async () => {
     const result = execSync('bun run src/index.ts search "Velo" --tag topic --format json');
     const nodes = JSON.parse(result);
     expect(nodes.every(n => n.name.toLowerCase().includes('velo'))).toBe(true);
   });
   ```

2. **CLI with tag only (regression)**
   ```typescript
   it('should return all tagged nodes when no query', async () => {
     const result = execSync('bun run src/index.ts search --tag topic --format json');
     // Should return all #topic nodes
   });
   ```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing `--tag` behavior | High | Low | Regression tests |
| Performance degradation with LIKE | Low | Low | Use index-friendly pattern |
| MCP schema change breaks clients | Medium | Low | Optional param is additive |

## Dependencies

### Internal

- `TanaQueryEngine.findNodesByTag()` - Add name filtering
- `handleTaggedSearch()` - Pass query parameter

### External

- None (using existing SQLite LIKE)

## Estimated Complexity

- **New files:** 2 (test files)
- **Modified files:** 4 (search.ts, tana-query-engine.ts, schemas.ts, tagged.ts)
- **Test files:** 2
- **Estimated tasks:** 8
- **Debt score:** 1 (simple bug fix, additive change)

## Implementation Order

1. [ ] Write failing unit test for `findNodesByTag` with `nameContains`
2. [ ] Implement `nameContains` in `findNodesByTag`
3. [ ] Write failing unit test for `handleTaggedSearch` with query
4. [ ] Modify `handleTaggedSearch` to accept and use query
5. [ ] Update `taggedSchema` to include `query` parameter
6. [ ] Update `tagged()` MCP tool to pass query
7. [ ] Write E2E test for CLI `search "query" --tag`
8. [ ] Run full test suite
