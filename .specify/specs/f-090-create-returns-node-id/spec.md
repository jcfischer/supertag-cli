---
quick-start: true
created: 2026-01-18T09:41:13.306Z
updated: 2026-01-18T11:00:00.000Z
status: complete
---

# Specification: create-returns-node-id

> **STATUS: COMPLETE** - Fixed API response parsing

## Resolution (2026-01-18)

**The Tana Input API DOES return node IDs - the client was parsing the wrong field.**

The API returns nodeIds in `children[].nodeId` format, not a top-level `nodeIds[]` array:

```json
// Actual API response from Tana Input API
{
  "children": [
    {"nodeId": "XeVGXeiJV3L0", "name": "Node Name", "type": "node"}
  ]
}
```

**Fix applied:** `src/api/client.ts:104-118` now correctly parses `children[].nodeId`.

**Test evidence:** `tests/integration/api-nodeids.test.ts`

## Overview

The `tana_create` MCP tool and CLI `create` command should reliably return the created node ID in the response, enabling immediate reference to newly created nodes without requiring a separate lookup or sync operation.

**Current Status:** Cannot implement - requires Tana to add nodeId return to Input API.

## Background Investigation

Current state analysis reveals:

1. **Code already handles nodeIds** - `src/api/client.ts:104-112` parses `nodeIds` from API response ✅
2. **Propagation exists** - `CreateNodeResult.nodeId` carries the ID through the stack ✅
3. **MCP response includes it** - `CreateResult.nodeId` is defined in the output type ✅
4. **API doesn't provide it** - Tana Input API returns empty `nodeIds` array ❌

**Root Cause:**
The Tana Input API (`addToNodeV2`) does not include created node IDs in its response. This is a limitation of the Tana API, not supertag-cli.

## User Scenarios

### Scenario 1: Create and Reference in Single Flow
**Given** an AI agent creating a meeting node with attendees
**When** the agent creates the meeting and then needs to link it to a project
**Then** the agent can use the returned `nodeId` immediately without searching

**Acceptance Criteria:**
- [ ] `nodeId` is present in response when create succeeds
- [ ] `nodeId` matches the actual node created in Tana
- [ ] `nodeId` can be used immediately in subsequent tana_node or inline reference calls

### Scenario 2: Create Multiple Related Nodes
**Given** an AI agent creating a parent node and child nodes
**When** the agent creates the parent first, then adds children referencing it
**Then** each create returns its nodeId enabling immediate reference construction

**Acceptance Criteria:**
- [ ] First create returns `parentNodeId`
- [ ] Second create can use `parentNodeId` in inline reference span
- [ ] Workflow completes without search/sync delays

### Scenario 3: Dry Run vs Actual Create
**Given** a user testing a create operation with `dryRun: true`
**When** the operation is validated successfully
**Then** `nodeId` should be `undefined` (no node created) but clearly indicated

**Acceptance Criteria:**
- [ ] `dryRun: true` response has `nodeId: undefined` or absent
- [ ] `dryRun: false` response has `nodeId` when API returns it
- [ ] Response clearly indicates whether nodeId is expected

## Functional Requirements

### FR-1: API Response Parsing
The Tana API client must reliably extract `nodeIds` from the response body.

**Current Implementation:**
```typescript
const data = await response.json() as { nodeIds?: string[] };
return {
  success: true,
  nodeIds: data.nodeIds || [],
};
```

**[TO BE REFINED]** Verify Tana API actually returns nodeIds. If not, investigate:
- Alternative response fields
- API version differences
- Required request parameters to receive nodeIds

### FR-2: MCP Tool Response Contract
The `tana_create` tool must include `nodeId` in its documented response.

**Requirements:**
- Update tool description to mention nodeId is returned
- Ensure `nodeId` is prominently placed in response (not buried in payload)
- Type as `nodeId: string | null` with clear semantics

### FR-3: CLI Output
The CLI `create` command must display the created nodeId.

**Requirements:**
- Print nodeId after successful create: `Created node: <nodeId>`
- Support `--format json` for scripting with nodeId in output
- Show `(dry run)` indicator when nodeId is not applicable

### FR-4: Error Handling
Handle cases where API succeeds but nodeId is missing.

**Requirements:**
- Treat missing nodeId as a warning, not failure
- Log warning if nodeId expected but absent
- Still return success (node was created, just ID unknown)

## Non-Functional Requirements

### NFR-1: Backwards Compatibility
Changes must not break existing integrations that don't use nodeId.

### NFR-2: Performance
No additional API calls to obtain nodeId - must come from create response.

## Success Criteria

1. `tana_create` response consistently includes `nodeId` when API provides it
2. AI agents can chain create -> reference operations without search
3. Tool description documents the nodeId return value
4. Tests verify nodeId is returned for actual (non-dryRun) creates

## Assumptions (INVALIDATED)

1. ~~Tana Input API returns `nodeIds` array in response~~ **FALSE - Returns empty array**
2. ~~The first element of `nodeIds` corresponds to the primary node created~~ **N/A**
3. ~~NodeId format matches Tana's internal node ID format~~ **N/A**

## Investigation Results (COMPLETED)

- [x] Verify Tana API actually returns nodeIds → **NO, returns `nodeIds: []`**
- [x] Determine if nodeIds require specific API parameters → **No parameters help**
- [ ] ~~Confirm nodeId format is consistent~~ → **N/A - no IDs returned**
- [ ] ~~Define behavior when batch create returns multiple nodeIds~~ → **N/A - no IDs returned**

## Possible Next Steps

### Option A: Request Feature from Tana (Recommended)
File feature request with Tana team to return created node IDs from Input API.
- **Contact:** Tana Discord or support
- **Rationale:** This is standard behavior for REST APIs (return created resource ID)

### Option B: Workaround - Search After Create
After creating a node, immediately search for it by name to find the ID.
- **Downsides:** Unreliable if multiple nodes have same name, adds latency, requires index sync
- **Not recommended** for production use

### Option C: Document Limitation
Update tool descriptions to clearly state that nodeId is not available.
- **Minimal effort** - just documentation change
- **User impact:** Users must manually link nodes or wait for index sync

## Completed Tasks

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 Investigation | ✅ DONE | Confirmed API returns empty nodeIds |
| T-2.x Documentation | PENDING | Update tool description with limitation |
| T-3.x Defensive code | SKIP | Not needed - expected empty |
| T-4.x Tests | ✅ DONE | `tests/integration/api-nodeids.test.ts` |
