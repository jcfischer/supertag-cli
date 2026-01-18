# Technical Plan: create-returns-node-id

## Architecture Overview

```
                              ┌────────────────────────────────────────┐
                              │            Tana Input API              │
                              │  POST https://europe-west1-...         │
                              │                                        │
                              │  Response: { nodeIds?: string[] }      │
                              └───────────────────┬────────────────────┘
                                                  │
                                                  ▼
┌──────────────────┐    ┌─────────────────────────────────────────────────────┐
│   CLI Command    │    │                TanaApiClient                        │
│   create.ts      │    │  src/api/client.ts:104-112                         │
│                  │    │                                                     │
│  ──────────────  │    │  ┌─────────────────────────────────────────────┐   │
│  Uses            │    │  │ const data = await response.json()          │   │
│  createNode()    │◄───┤  │ return { success: true,                     │   │
│                  │    │  │         nodeIds: data.nodeIds || [] }       │   │
└────────┬─────────┘    │  └─────────────────────────────────────────────┘   │
         │              └───────────────────┬─────────────────────────────────┘
         │                                  │
         ▼                                  ▼
┌──────────────────┐    ┌─────────────────────────────────────────────────────┐
│   MCP Tool       │    │              node-builder.ts                        │
│   create.ts      │    │  src/services/node-builder.ts:350-359              │
│                  │    │                                                     │
│  ──────────────  │    │  ┌─────────────────────────────────────────────┐   │
│  Uses            │◄───┤  │ return {                                    │   │
│  createNode()    │    │  │   success: true,                            │   │
│                  │    │  │   nodeId: response.nodeIds?.[0] ?? undef,   │◄──┼── FIX HERE
│  Returns         │    │  │   payload, target, dryRun: false            │   │
│  CreateResult    │    │  │ }                                           │   │
└──────────────────┘    │  └─────────────────────────────────────────────┘   │
                        └─────────────────────────────────────────────────────┘
```

**Current Flow Analysis:**

1. **API Client** (`src/api/client.ts:104-112`) - Already parses `nodeIds` from response ✅
2. **Node Builder** (`src/services/node-builder.ts:350-359`) - Already extracts first ID ✅
3. **MCP Tool** (`src/mcp/tools/create.ts:65`) - Already passes `nodeId` through ✅
4. **CLI Command** (`src/commands/create.ts:410-412`) - Already displays `nodeId` ✅

**The infrastructure is complete.** The issue is:
- Tool description doesn't document that `nodeId` is returned
- No tests verify `nodeId` is returned for actual API calls
- Tana API behavior with `nodeIds` is undocumented

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Testing | bun:test | Project pattern for unit and integration tests |
| HTTP | fetch | Already used in `TanaApiClient` |
| Schema | Zod | MCP schema validation already uses Zod |

## Data Model

Existing types are sufficient - no changes needed:

```typescript
// src/types.ts - Already exists
interface TanaApiResponse {
  success: boolean;
  nodeIds?: string[];  // Optional - API may not always return
  error?: string;
}

interface CreateNodeResult {
  success: boolean;
  nodeId?: string;      // Already defined as optional
  payload: TanaApiNode;
  target: string;
  dryRun: boolean;
  error?: string;
}

// src/mcp/tools/create.ts - Already exists
interface CreateResult {
  workspace: string;
  supertag: string;
  name: string;
  target: string;
  dryRun: boolean;
  validated: boolean;
  payload: TanaApiNode;
  nodeId?: string;      // Already defined
  error?: string;
}
```

## API Contracts

### Input (unchanged)

```typescript
// tana_create input schema
{
  supertag: string;           // Required: e.g., "todo"
  name: string;               // Required: node title
  fields?: Record<string, string | string[]>;
  children?: ChildNodeInput[];
  workspace?: string;
  target?: string;            // Default: "INBOX"
  dryRun?: boolean;           // Default: false
}
```

### Output (enhanced documentation)

```typescript
// tana_create response - actual create (dryRun: false)
{
  workspace: "main",
  supertag: "todo",
  name: "Buy groceries",
  target: "INBOX",
  dryRun: false,
  validated: true,
  payload: { ... },           // TanaApiNode that was sent
  nodeId: "abc123xyz"         // RETURNED: created node ID (if API provides)
}

// tana_create response - dry run (dryRun: true)
{
  workspace: "main",
  supertag: "todo",
  name: "Buy groceries",
  target: "INBOX",
  dryRun: true,
  validated: true,
  payload: { ... },           // TanaApiNode that would be sent
  // nodeId: undefined        // NOT PRESENT: no node created
}
```

## Implementation Phases

### Phase 1: Verify Tana API Behavior (Investigation)

**Goal:** Confirm that Tana Input API actually returns `nodeIds` in the response.

**Actions:**
1. Create integration test that makes real API call (requires API token)
2. Log and verify the actual response structure
3. Document findings in spec

**Test file:** `tests/integration/api-nodeids.test.ts`

```typescript
// Pseudo-code for investigation
describe('Tana API nodeIds response', () => {
  it('should return nodeIds after successful create', async () => {
    const client = createApiClient(process.env.TANA_API_TOKEN, API_ENDPOINT);
    const response = await client.postNodes('INBOX', [{ name: 'API Test Node' }]);

    console.log('API Response:', JSON.stringify(response, null, 2));

    expect(response.success).toBe(true);
    expect(response.nodeIds).toBeDefined();
    expect(response.nodeIds.length).toBeGreaterThan(0);
  });
});
```

### Phase 2: Enhance Tool Documentation

**Goal:** Update MCP tool descriptions to clearly document `nodeId` in response.

**Files to modify:**

1. **`src/mcp/tool-registry.ts:165-169`**
   ```typescript
   {
     name: 'tana_create',
     description: 'Create new node with supertag. Returns nodeId of created node.',
     category: 'mutate',
     example: 'Create a new #todo item',
   },
   ```

2. **`src/mcp/index.ts:111-114`** - Update tool description in `listTools()`
   ```typescript
   {
     name: 'tana_create',
     description: 'Create a new node with supertag. Returns created nodeId in response for chaining.',
     inputSchema: schemas.zodToJsonSchema(schemas.createSchema),
   },
   ```

### Phase 3: Add Warning for Missing nodeId

**Goal:** Log warning if API succeeds but nodeId is missing (defensive).

**File:** `src/services/node-builder.ts:350-365`

```typescript
if (response.success) {
  const nodeId = response.nodeIds?.[0];

  // Warn if nodeId missing but create succeeded
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

### Phase 4: Add Tests for nodeId Propagation

**Goal:** Ensure nodeId flows correctly through the stack.

**Test files:**

1. **`tests/mcp/create.test.ts`** - Add tests for nodeId in MCP response
   ```typescript
   describe('nodeId in response', () => {
     it('should include nodeId when API returns it', async () => {
       // Mock API response with nodeId
       const result = await create({
         supertag: 'todo',
         name: 'Test',
         dryRun: false,
       });
       expect(result.nodeId).toBeDefined();
     });

     it('should have undefined nodeId in dry run mode', async () => {
       const result = await create({
         supertag: 'todo',
         name: 'Test',
         dryRun: true,
       });
       expect(result.nodeId).toBeUndefined();
     });
   });
   ```

2. **`tests/unit/node-builder-nodeid.test.ts`** - Unit tests for node-builder

### Phase 5: Update CLI Output

**Goal:** Ensure CLI clearly displays nodeId when available.

**File:** `src/commands/create.ts:407-420`

Already implemented:
```typescript
if (result.success) {
  console.log(`✅ Node created successfully in Tana`);
  if (result.nodeId) {
    console.log(`   Node ID: ${result.nodeId}`);  // Already exists
  }
}
```

No changes needed here.

## File Structure

```
src/
├── api/
│   └── client.ts                    # No changes (already parses nodeIds)
├── services/
│   └── node-builder.ts              # Add warning for missing nodeId
├── mcp/
│   ├── index.ts                     # Update tool description
│   ├── tool-registry.ts             # Update tool description
│   └── tools/
│       └── create.ts                # No changes (already propagates nodeId)
├── commands/
│   └── create.ts                    # No changes (already displays nodeId)
└── types.ts                         # No changes (types already correct)

tests/
├── integration/
│   └── api-nodeids.test.ts          # NEW: Verify API behavior
├── mcp/
│   └── create.test.ts               # Add nodeId tests
└── unit/
    └── node-builder-nodeid.test.ts  # NEW: Unit tests for nodeId flow
```

## Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| Tana API Token | Required for integration tests | Environment variable |
| bun:test | Test framework | Already installed |
| Zod | Schema validation | Already installed |

**External dependencies:** None new required.

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Tana API doesn't return nodeIds | High | Medium | Investigation phase will confirm; fallback is to document limitation |
| API returns nodeIds inconsistently | Medium | Low | Handle gracefully with optional type; log warning |
| Breaking existing integrations | Low | Very Low | All changes are additive; nodeId already optional |
| Test flakiness with real API | Medium | Medium | Mark integration tests as slow; skip in CI without token |

## Success Criteria

1. ✅ `tana_create` tool description mentions `nodeId` is returned
2. ✅ Integration test verifies Tana API returns `nodeIds` (or documents limitation)
3. ✅ Unit tests verify `nodeId` propagation through the stack
4. ✅ CLI displays `nodeId` when available (already implemented)
5. ✅ Warning logged if `nodeId` expected but missing

## Assumptions

1. **Tana API returns `nodeIds` array** - To be verified in Phase 1
2. **First element of `nodeIds` is the primary created node** - Assumed based on single-node creates
3. **`nodeId` format is consistent with other Tana node IDs** - Same format used in `tana_node` lookups

## Refinements from Spec

| Spec Question | Resolution |
|---------------|------------|
| Verify Tana API returns nodeIds | Phase 1 investigation with real API call |
| nodeIds require specific params? | Test in Phase 1; no special params expected |
| nodeId format consistency | Test lookup with returned ID in Phase 4 |
| Batch create behavior | Out of scope - separate spec for `tana_batch_create` |

## Estimated Effort

| Phase | Complexity | Notes |
|-------|------------|-------|
| Phase 1: Investigation | Low | 1 test file, real API call |
| Phase 2: Documentation | Low | 2-3 string changes |
| Phase 3: Warning | Low | 5 lines of code |
| Phase 4: Tests | Medium | 2 test files, mocking needed |
| Phase 5: CLI | None | Already implemented |

**Total:** Small feature - primarily documentation and testing.
