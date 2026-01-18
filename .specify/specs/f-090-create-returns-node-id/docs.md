# Documentation: create-returns-node-id

## Summary

**Status: COMPLETE**

The `tana_create` and `tana_batch_create` MCP tools now correctly return created node IDs, enabling immediate chaining of create→reference operations.

## Root Cause

The API client at `src/api/client.ts` was parsing a non-existent `nodeIds[]` field. The actual Tana API response format is:

```json
{
  "children": [
    {"nodeId": "XeVGXeiJV3L0", "name": "Node Name", "type": "node"}
  ]
}
```

## Changes Made

### 1. API Client Fix (`src/api/client.ts:104-118`)

```typescript
// Before (incorrect):
const data = await response.json() as { nodeIds?: string[] };
return { success: true, nodeIds: data.nodeIds || [] };

// After (correct):
const data = await response.json() as {
  children?: Array<{ nodeId?: string; name?: string; type?: string }>;
  nodeIds?: string[];  // Legacy format, kept for compatibility
};
const nodeIds = data.children
  ?.map(child => child.nodeId)
  .filter((id): id is string => id !== undefined)
  ?? data.nodeIds
  ?? [];
return { success: true, nodeIds };
```

### 2. Tool Description Updates

- **`src/mcp/tool-registry.ts`**: "Returns nodeId of created node for chaining."
- **`src/mcp/index.ts`**: "Returns nodeId of created node for immediate chaining."

### 3. Integration Tests (`tests/integration/api-nodeids.test.ts`)

- Verifies single node create returns nodeId
- Verifies batch create returns multiple nodeIds
- Validates nodeId format (alphanumeric pattern)

## User Impact

AI agents using `tana_create` can now:
1. Create a node
2. Immediately use the returned `nodeId` to reference it in subsequent operations
3. No need to wait for 6-hour sync cycle

## Example

```typescript
// Create outcome-goal
const goal = await tana_create({
  supertag: "outcome-goal",
  name: "HWZ Lecturer Expansion 2026"
});

// Immediately use nodeId in todo's Focus field
await tana_create({
  supertag: "todo",
  name: "Search HWZ website",
  fields: {
    "Focus": goal.nodeId  // Now available immediately!
  }
});
```
