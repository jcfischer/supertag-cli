# Implementation Tasks: create-returns-node-id

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ✅ DONE | Investigation - Found API returns children[].nodeId format |
| T-2.1 | ✅ DONE | Updated tool-registry.ts to document nodeId return |
| T-2.2 | ✅ DONE | Updated MCP index.ts to document nodeId return |
| T-3.1 | ✅ DONE | Fixed client.ts to parse children[].nodeId correctly |
| T-4.1 | SKIP | Not needed - client parsing is the fix |
| T-4.2 | SKIP | Not needed - nodeId now flows through correctly |
| T-4.3 | ✅ DONE | Integration tests verify nodeId is returned |

## Root Cause

The API client at `src/api/client.ts:104-112` was parsing `nodeIds[]` but the actual API response uses `children[].nodeId` format.

---

## Group 1: Investigation

### T-1.1: Verify Tana API returns nodeIds [T]
- **File:** tests/integration/api-nodeids.test.ts (NEW)
- **Test:** Self-contained integration test
- **Dependencies:** None
- **Description:** Create integration test that makes real API call to verify Tana Input API returns `nodeIds` in response. This test requires `TANA_API_TOKEN` environment variable and should be marked as slow. Documents API behavior for the spec.

**Acceptance Criteria:**
- [ ] Test makes real API call to create a node
- [ ] Test logs full API response structure
- [ ] Test verifies `nodeIds` is an array with at least one element
- [ ] Test is marked with `@slow` annotation
- [ ] Test skips gracefully if `TANA_API_TOKEN` not set

**Implementation notes:**
```typescript
// Use existing TanaApiClient from src/api/client.ts
// Target: INBOX (default target)
// Create minimal node: { name: 'API Test Node' }
// Cleanup: Not required (creates in user's INBOX - user can delete)
```

---

## Group 2: Documentation Updates [P]

### T-2.1: Update tool registry description
- **File:** src/mcp/tool-registry.ts
- **Test:** None (string change only)
- **Dependencies:** None
- **Description:** Update `tana_create` tool description to mention that `nodeId` is returned in the response.

**Acceptance Criteria:**
- [ ] Description mentions `nodeId` return value
- [ ] Example still makes sense

**Target location:** Around line 165-169, look for:
```typescript
{
  name: 'tana_create',
  description: '...',
}
```

**Change to:**
```typescript
{
  name: 'tana_create',
  description: 'Create new node with supertag. Returns nodeId of created node for chaining.',
  category: 'mutate',
  example: 'Create a new #todo item',
}
```

### T-2.2: Update MCP index description [P with T-2.1]
- **File:** src/mcp/index.ts
- **Test:** None (string change only)
- **Dependencies:** None
- **Description:** Update tool description in `listTools()` response to document `nodeId` return value.

**Acceptance Criteria:**
- [ ] Description mentions `nodeId` in response
- [ ] Mentions "for chaining" to indicate use case

**Target location:** Around line 111-114, in `listTools()` method.

**Change to:**
```typescript
{
  name: 'tana_create',
  description: 'Create a new node with supertag. Returns created nodeId in response for chaining.',
  inputSchema: schemas.zodToJsonSchema(schemas.createSchema),
}
```

---

## Group 3: Defensive Enhancement

### T-3.1: Add warning for missing nodeId [T]
- **File:** src/services/node-builder.ts
- **Test:** tests/unit/node-builder-nodeid.test.ts (NEW)
- **Dependencies:** T-1.1 (to understand expected behavior)
- **Description:** Add defensive warning when API succeeds but does not return `nodeId`. This handles edge cases where Tana API behavior changes.

**Acceptance Criteria:**
- [ ] Warning logged when `response.success` but `nodeIds` empty/missing
- [ ] Warning does NOT log in dryRun mode (expected behavior)
- [ ] Function still returns success (node was created)
- [ ] `nodeId` is undefined in result when missing

**Target location:** Around line 350-360, after API call succeeds:
```typescript
if (response.success) {
  const nodeId = response.nodeIds?.[0];

  // Add warning here
  if (!nodeId) {
    getLogger().warn('Node created but API did not return nodeId');
  }

  return {
    success: true,
    nodeId,  // May be undefined
    payload,
    target,
    dryRun: false,
  };
}
```

---

## Group 4: Test Coverage [P]

### T-4.1: Unit tests for nodeId propagation [T]
- **File:** tests/unit/node-builder-nodeid.test.ts (NEW)
- **Test:** Self-contained unit tests
- **Dependencies:** T-3.1
- **Description:** Unit tests for node-builder.ts nodeId handling, including mocked API responses.

**Acceptance Criteria:**
- [ ] Test: nodeId extracted from `response.nodeIds[0]`
- [ ] Test: nodeId undefined when `nodeIds` empty
- [ ] Test: nodeId undefined when `nodeIds` missing
- [ ] Test: warning logged when nodeId missing
- [ ] Test: dryRun mode has no nodeId and no warning

**Test cases:**
```typescript
describe('nodeId propagation', () => {
  it('extracts nodeId from response.nodeIds[0]', async () => {
    // Mock API response with nodeIds: ['abc123']
    // Verify result.nodeId === 'abc123'
  });

  it('returns undefined nodeId when nodeIds empty', async () => {
    // Mock API response with nodeIds: []
    // Verify result.nodeId === undefined
    // Verify warning was logged
  });

  it('returns undefined nodeId when nodeIds missing', async () => {
    // Mock API response without nodeIds field
    // Verify result.nodeId === undefined
    // Verify warning was logged
  });

  it('does not warn in dry run mode', async () => {
    // dryRun: true
    // Verify no warning logged (expected to have no nodeId)
  });
});
```

### T-4.2: MCP tests for nodeId in response [T] [P with T-4.1]
- **File:** tests/mcp/create.test.ts (ADD to existing)
- **Test:** Integration with mocked dependencies
- **Dependencies:** T-2.1, T-2.2
- **Description:** Add tests to existing MCP create tests verifying nodeId flows through to MCP response.

**Acceptance Criteria:**
- [ ] Test: nodeId present in response when API returns it
- [ ] Test: nodeId undefined in dry run mode
- [ ] Test: response structure documented in test

**Test location:** Add new describe block to existing file:
```typescript
describe('nodeId in response', () => {
  it('includes nodeId when API returns it', async () => {
    // Setup mock to return nodeIds
    const result = await handleCreate({ supertag: 'todo', name: 'Test' });
    expect(result.nodeId).toBeDefined();
  });

  it('has undefined nodeId in dry run mode', async () => {
    const result = await handleCreate({ supertag: 'todo', name: 'Test', dryRun: true });
    expect(result.nodeId).toBeUndefined();
  });
});
```

### T-4.3: Integration test for API nodeIds [T]
- **File:** tests/integration/api-nodeids.test.ts (same as T-1.1)
- **Test:** Real API integration test
- **Dependencies:** T-1.1 (extends the investigation test)
- **Description:** Extend the investigation test to also verify the returned nodeId can be used in subsequent operations.

**Acceptance Criteria:**
- [ ] Test: created nodeId can be looked up via tana_node tool
- [ ] Test: nodeId format matches expected pattern (alphanumeric)
- [ ] Test marked as slow and skipped without API token

**Additional test case:**
```typescript
it('returned nodeId is usable in tana_node lookup', async () => {
  // Create node, get nodeId
  // Use nodeId to fetch node via tana_node or nodes show
  // Verify retrieved node name matches created name
});
```

---

## Execution Order

```
Phase 1 (Investigation):
  T-1.1  ─────────────────────────────────────►

Phase 2 (Documentation - parallel):
  T-2.1  ─────►
  T-2.2  ─────►  (parallel with T-2.1)

Phase 3 (Defensive code):
  T-3.1  ─────────────► (after T-1.1 to understand expected behavior)

Phase 4 (Tests - parallel):
  T-4.1  ─────────────►  (after T-3.1)
  T-4.2  ─────────────►  (parallel with T-4.1, after T-2.1/T-2.2)
  T-4.3  ─────────────►  (after T-1.1, extends it)
```

**Parallel execution opportunities:**
- T-2.1 and T-2.2 can run in parallel (both are string changes)
- T-4.1 and T-4.2 can run in parallel (different test files)

**Critical path:** T-1.1 → T-3.1 → T-4.1

---

## Summary

| Metric | Count |
|--------|-------|
| Total tasks | 7 |
| Parallelizable | 4 (T-2.1, T-2.2, T-4.1, T-4.2) |
| New files | 2 (tests/integration/api-nodeids.test.ts, tests/unit/node-builder-nodeid.test.ts) |
| Modified files | 3 (tool-registry.ts, index.ts, node-builder.ts) |
| Test tasks | 5 |

**Complexity assessment:** Low - primarily documentation and test coverage. Infrastructure already exists; this spec verifies and documents it.
