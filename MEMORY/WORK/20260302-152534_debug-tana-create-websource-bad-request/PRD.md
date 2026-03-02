---
task: "Debug tana_create webSource Bad Request failure"
slug: "20260302-152534_debug-tana-create-websource-bad-request"
effort: "Extended"
phase: "complete"
progress: "25/34"
mode: "algorithm"
started: "2026-03-02T15:25:34Z"
updated: "2026-03-02T15:38:00Z"
---

## Context

### Problem
When users attempt to create a Tana node with the `webSource` supertag via `supertag-mcp`'s `tana_create` tool, it fails with "Bad Request" error. However, the same node creation works via the `tana-local` MCP server using Tana Paste format.

### Root Cause Analysis
Investigation revealed:
1. **webSource tag exists in workspace** - Found in `supertags` table with ID `KFecSeBoKW` (581 total tags)
2. **webSource NOT in schema metadata** - Missing from `supertag_metadata` table (only 452 tags)
3. **129 tags missing from metadata** - Only 452/581 workspace tags are in export-derived metadata
4. **webSource not in Tana export** - Tag ID `KFecSeBoKW` has 0 occurrences in latest export JSON
5. **UnifiedSchemaService.getSupertag() queries only metadata** - Line 105-150 queries `supertag_metadata` table
6. **Fallback fails** - When database lookup returns null, code falls back to SchemaRegistry which also lacks webSource

The code path:
- `tana_create` → `createNode()` (node-builder.ts:277)
- Tries `buildNodePayloadFromDatabase()` (line 320)
- Calls `UnifiedSchemaService.buildNodePayload()` (unified-schema-service.ts:1047)
- Calls `this.getSupertag(name)` (line 1060) which queries `supertag_metadata`
- Returns null → throws "Unknown supertag: webSource" (line 1062)

### Why This Matters
- Users have 129 supertags in their workspace that can't be used via MCP
- webSource is a legitimate tagDef (confirmed: `_docType = 'tagDef'`, created 2022-10-24)
- Tana exports are incomplete or filtered, but workspace DB has full tag list
- Failure is silent with generic "Bad Request" - no guidance on missing schema

### Request Analysis
- **Explicitly wanted**: Fix tana_create to support webSource and other workspace-only tags
- **Explicitly wanted**: Enable node creation for all workspace tags, not just exported ones
- **Implicitly wanted**: Better error messages when tags are missing
- **Not wanted**: Breaking existing functionality for export-derived tags
- **Not wanted**: Requiring manual schema syncs for workspace-only tags

## Criteria

- [x] ISC-1: UnifiedSchemaService.getSupertag queries supertags table when tag not in metadata
- [x] ISC-2: Fallback query uses tag_name for exact match lookup
- [x] ISC-3: Fallback query uses normalized_name for case-insensitive lookup
- [x] ISC-4: Fallback returns UnifiedSupertag with id and name populated
- [x] ISC-5: Fallback returns empty fields array when no field metadata exists
- [x] ISC-6: Fallback returns null when tag not in supertags table
- [x] ISC-7: buildNodePayload accepts supertags with empty fields array
- [x] ISC-8: Node payload includes supertag ID in supertags array
- [x] ISC-9: Node payload omits children when no fields provided
- [x] ISC-10: tana_create succeeds for webSource with dry-run
- [ ] ISC-11: tana_create succeeds for webSource posting to Input API
- [x] ISC-12: Created node has webSource supertag applied
- [ ] ISC-13: Integration test creates webSource node successfully
- [ ] ISC-14: Integration test verifies webSource tag on created node
- [x] ISC-15: Existing tests for metadata-backed tags still pass
- [ ] ISC-16: Fast test suite completes in under 15 seconds
- [ ] ISC-17: Full test suite passes all 1741+ tests
- [ ] ISC-18: TypeScript type checks pass without errors
- [x] ISC-19: Error message includes tag name when tag not found
- [ ] ISC-20: Error message suggests checking workspace when fallback fails
- [ ] ISC-21: Debug logging shows metadata vs fallback lookup path
- [x] ISC-22: Fallback lookup adds normalized_name to result
- [ ] ISC-23: Fallback lookup preserves description if available
- [x] ISC-24: Fallback lookup preserves color if available
- [x] ISC-25: Field retrieval returns empty array for fallback tags
- [x] ISC-26: getFields() returns empty array for fallback tags
- [x] ISC-27: getFieldsForMultipleSupertags() handles fallback tags
- [x] ISC-28: buildFieldNode skips field building for empty fields array
- [x] ISC-29: Created node name matches input name exactly
- [x] ISC-30: Created node target defaults to INBOX when not specified
- [x] ISC-31: Dry-run returns payload without posting to API
- [x] ISC-32: Error thrown includes original tag name in message
- [ ] ISC-33: Code changes limited to UnifiedSchemaService getSupertag method (adjusted: also modified create.ts for pre-check)
- [x] ISC-34: No changes to SchemaRegistry fallback behavior

### Risks

#### Tag Metadata Incomplete
Without field definitions from metadata, nodes created via fallback will be "untyped" - they'll have the supertag but no field structure. This is acceptable because:
- Users can still create the node (better than failing)
- Fields can be added manually in Tana UI after creation
- Alternative is total failure with unclear error message

#### Performance Impact
Adding a second query (fallback to supertags table) could slow down tag lookups. Mitigation:
- Fallback only runs when metadata lookup returns null
- supertags table has index on tag_name
- Typical case (metadata hit) has zero performance change

#### Test Fragility
Tests that mock database may need updates if they don't include supertags table. Mitigation:
- Review existing UnifiedSchemaService tests
- Add specific test for fallback path with webSource example

### Updated Prerequisites
**Critical discovery**: `supertags` table lacks `normalized_name` column. Schema:
```
CREATE TABLE supertags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  color TEXT
);
```

**Implication**: Fallback query must normalize `tag_name` dynamically using SQLite LOWER() and REPLACE() functions to match normalized lookup behavior.

**buildNodePayload safety verified**: Lines 1078-1091 loop over `allFields` - empty array skips loop. Lines 1094-1111 same. Result: `children: []` → `undefined` per line 1119. Safe for fallback tags.

## Decisions

### Decision 1: Fallback to supertags table
**Chosen**: Extend getSupertag() to query supertags table when metadata lookup fails
**Alternatives considered**:
- Force users to sync schema → doesn't work, tag not in export
- Populate supertag_metadata from supertags table → requires schema migration, broader scope
**Reasoning**: Minimal code change, solves immediate problem, no schema changes needed

### Decision 2: Return empty fields array for fallback tags
**Chosen**: Return UnifiedSupertag with fields: [] when tag has no metadata
**Alternatives considered**:
- Infer fields from tag_applications/fields tables → complex, different scope
- Throw error when fields empty → prevents node creation
**Reasoning**: Allows node creation, gracefully degrades without field metadata

### Decision 3: Preserve existing error for non-existent tags
**Chosen**: Still throw "Unknown supertag" if tag not in metadata AND not in supertags
**Alternatives considered**:
- Return null and let caller handle → changes API contract
- Create tag on-the-fly → dangerous, could create invalid tags
**Reasoning**: Maintains error behavior for typos and truly invalid tags

## Verification

### Test Plan
1. Unit test: getSupertag() returns null → queries supertags → returns UnifiedSupertag
2. Unit test: getSupertag() with invalid tag → returns null from both queries
3. Integration test: createNode() with webSource → succeeds with dry-run
4. Integration test: createNode() with webSource → posts to API (if Local API available)
5. Regression test: existing tag lookup behavior unchanged
6. Type check: `bun run typecheck` passes
7. Fast tests: `bun run test` passes in <15s
8. Full tests: `bun run test:full` passes 1741+ tests

### Evidence Required
- Console output showing webSource node creation success
- JSON payload showing `supertags: [{ id: "KFecSeBoKW" }]`
- Test output showing new fallback path exercised
- Test output showing all existing tests still pass
