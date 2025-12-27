# Tasks: Explicit Field Types in Node Creation

## Progress Tracking

| Task | Description | Status | Notes |
|------|-------------|--------|-------|
| T-1 | Write failing test for database-backed createNode | completed | TDD RED - 2025-12-27 |
| T-2 | Implement database path resolution in createNode | completed | TDD GREEN - 2025-12-27 |
| T-3 | Write test for fallback when no database | completed | Test included in T-1 - 2025-12-27 |
| T-4 | Verify fallback implementation | completed | Verified - 2025-12-27 |
| T-5 | Run full test suite | completed | 279 fast tests pass, build complete - 2025-12-27 |
| T-6 | Fix duplicate supertag handling in getSupertag | completed | Pick canonical entry with most inheritance/fields - 2025-12-28 |

## Task Details

### T-1: Write failing test for database-backed createNode [T]

**File:** `src/services/node-builder.test.ts`

Write test that:
1. Creates temp database with explicit field types (e.g., `inferred_data_type = 'date'`)
2. Calls `createNode()` with a date field value
3. Asserts payload includes `dataType: "date"`

Test should FAIL because `createNode()` doesn't use database yet.

### T-2: Implement database path resolution in createNode [T]

**File:** `src/services/node-builder.ts`

Modify `createNode()` to:
1. Import `resolveWorkspace` from config/paths
2. Get workspace database path
3. Check if database exists with `existsSync()`
4. If exists, use `buildNodePayloadFromDatabase(dbPath, input)`
5. If not, fall back to `buildNodePayload(registry, input)`

Test from T-1 should PASS after this.

### T-3: Write test for fallback when no database [T]

**File:** `src/services/node-builder.test.ts`

Write test that:
1. Ensures no database exists at expected path
2. Calls `createNode()`
3. Verifies it uses registry-based approach without errors

### T-4: Verify fallback implementation [T]

Verify T-3 test passes (should already work from T-2 implementation).

### T-5: Run full test suite [T]

```bash
bun test --randomize
```

All tests must pass with no regressions.

### T-6: Fix duplicate supertag handling in getSupertag [T]

**File:** `src/services/unified-schema-service.ts`

**Issue:** Database can have multiple entries for the same supertag name (e.g., 3 "todo" entries with fields spread across them). The original `LIMIT 1` query returned the wrong one.

**Fix:** Updated `getSupertag()` to match `SchemaRegistry.shouldPreferSchema()` logic:
1. Prefer supertags with more inheritance parents
2. Then prefer supertags with more own fields

This ensures the canonical supertag (with the most complete definition) is returned.

## Blockers

| Blocker | Impact | Resolution |
|---------|--------|------------|
| None | - | - |
