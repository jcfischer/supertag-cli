# Implementation Tasks: F-091 unified-field-format

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ✅ | Field normalizer core |
| T-1.2 | ✅ | Unit tests for normalizer (35 tests, 102 assertions) |
| T-2.1 | ✅ | Integrate into node-builder |
| T-2.2 | ✅ | Node-builder integration tests |
| T-3.1 | ✅ | Update CLI create command |
| T-3.2 | ✅ | CLI integration tests (15 new tests) |
| T-4.1 | ✅ | MCP integration tests (15 new tests) |
| T-5.1 | ⏭️ | Field validation with suggestions (deferred - optional enhancement) |
| T-5.2 | ⏭️ | Validation tests (deferred - optional enhancement) |
| T-6.1 | ✅ | Regression test suite (2378 pass, 0 fail) |

---

## Group 1: Foundation — Field Normalizer

### T-1.1: Create normalizeFieldInput() utility [T]
- **File:** `src/services/field-normalizer.ts` (NEW)
- **Test:** `src/services/field-normalizer.test.ts` (T-1.2)
- **Dependencies:** none
- **Description:** Create the core normalization function that converts both nested `{"fields": {...}}` and flat `{fieldName: value}` formats to a canonical flat format.

**Implementation details:**
1. Define `RESERVED_KEYS` constant (name, title, label, heading, subject, summary, supertag, children, target, workspace, dryRun, fields)
2. Define `NormalizeResult` interface with `fields`, `inputFormat`, and optional `unrecognizedFields`
3. Implement `normalizeFieldInput(input, options?)`:
   - Check if `input.fields` exists and is a non-null object → nested format detected
   - Extract flat fields: all top-level keys not in RESERVED_KEYS
   - If both nested and flat exist → mixed format; merge with nested taking precedence
   - Return `{ fields, inputFormat }`
4. Export `isReservedKey(key: string)` helper for reuse

**Key behavior:**
- Nested `fields` property values override flat values for same key
- Reserved keys are never treated as fields
- Empty input returns `{ fields: {}, inputFormat: 'flat' }`

---

### T-1.2: Unit tests for normalizeFieldInput [T] [P with T-1.1]
- **File:** `src/services/field-normalizer.test.ts` (NEW)
- **Dependencies:** T-1.1
- **Description:** Comprehensive unit tests for the normalizer covering all format variations and edge cases.

**Test cases:**
1. Format detection:
   - Nested format: `{ fields: { Status: "Done" } }` → inputFormat: "nested"
   - Flat format: `{ Status: "Done" }` → inputFormat: "flat"
   - Mixed format: `{ Status: "Done", fields: { Priority: "High" } }` → inputFormat: "mixed"
   - Empty input: `{}` → inputFormat: "flat", fields: {}

2. Reserved keys:
   - `{ name: "Task", Status: "Done" }` → fields excludes "name"
   - All 12 reserved keys tested individually
   - `{ fields: { name: "should-be-field" } }` → "name" inside nested fields IS extracted

3. Precedence:
   - `{ Status: "Flat", fields: { Status: "Nested" } }` → Status = "Nested"
   - Mixed fields merge correctly

4. Value types:
   - String values preserved
   - Array values preserved (multi-select fields)
   - Null/undefined values handled gracefully

5. Edge cases:
   - `{ fields: null }` → treated as flat format
   - `{ fields: "string" }` → treated as flat format (fields must be object)
   - Deeply nested objects not recursed (only one level)

---

## Group 2: Core Integration — Node Builder

### T-2.1: Integrate normalizer into node-builder.ts [T]
- **File:** `src/services/node-builder.ts` (MODIFY)
- **Test:** `src/services/node-builder.test.ts` (EXISTING + new cases)
- **Dependencies:** T-1.1
- **Description:** Add normalization call at the entry point of `createNode()` so all field inputs are processed consistently.

**Implementation details:**
1. Import `normalizeFieldInput` from `./field-normalizer`
2. At the start of `createNode()`, normalize the input:
   ```typescript
   const inputWithFields = {
     ...input,
     ...(typeof input === 'object' ? input : {}),
   };
   const normalized = normalizeFieldInput(inputWithFields);
   ```
3. Use `normalized.fields` when passing to `buildNodePayload()`
4. Add verbose logging: `if (verbose) log("Field format detected:", normalized.inputFormat)`

**Critical:** This is the single integration point—both MCP and CLI flow through here.

---

### T-2.2: Node-builder integration tests [T]
- **File:** `src/services/node-builder.test.ts` (MODIFY)
- **Dependencies:** T-2.1
- **Description:** Add integration tests verifying that createNode accepts both field formats.

**Test cases:**
1. Nested format creates correct payload
2. Flat format continues to work (regression)
3. Mixed format merges correctly
4. Field mapping to attribute IDs works with both formats
5. dryRun mode shows correct payload for both formats

---

## Group 3: CLI Integration

### T-3.1: Update CLI create command to use normalizer [T]
- **File:** `src/commands/create.ts` (MODIFY)
- **Dependencies:** T-2.1
- **Description:** Replace the local `extractFieldsFromJson()` function with the shared normalizer.

**Implementation details:**
1. Import `normalizeFieldInput` from `../services/field-normalizer`
2. Find `extractFieldsFromJson()` usage (around line 445)
3. Replace with:
   ```typescript
   const normalized = normalizeFieldInput(jsonObj as Record<string, unknown>);
   fieldValues = normalized.fields;
   ```
4. Optionally deprecate or remove `extractFieldsFromJson()` if no longer needed
5. Add verbose logging for format detection

**Backwards compatibility:** Flat format (existing behavior) continues to work unchanged.

---

### T-3.2: CLI integration tests [T]
- **File:** `tests/cli/create-fields.test.ts` (NEW)
- **Dependencies:** T-3.1
- **Description:** Integration tests for CLI create command with both field formats.

**Test cases:**
1. `--json '{"name": "Task", "Status": "Done"}'` works (flat, existing)
2. `--json '{"name": "Task", "fields": {"Status": "Done"}}'` works (nested, new)
3. `--json '{"name": "Task", "Status": "X", "fields": {"Status": "Y"}}'` uses "Y" (precedence)
4. Combined with `--tag` option
5. Combined with `--verbose` shows format detection
6. Error case: invalid field name shows helpful message

---

## Group 4: MCP Integration

### T-4.1: MCP integration tests [T] [P with T-3.2]
- **File:** `src/mcp/tools/create.test.ts` (MODIFY or NEW)
- **Dependencies:** T-2.1
- **Description:** Integration tests verifying MCP `tana_create` tool works with nested fields format.

**Test cases:**
1. Nested format: `{ supertag: "todo", name: "Task", fields: { Status: "Done" }, dryRun: true }`
   - Verify payload contains correct field tuple
2. Verify no "not found in schema, skipped" message for valid fields
3. Same payload produced for equivalent nested and flat inputs
4. Multiple fields work together
5. Reference fields (like `⚙️ Vault`) work with nested format
6. Options fields work with nested format

**Note:** MCP tool itself may not need code changes if node-builder handles normalization. These tests verify the end-to-end flow.

---

## Group 5: Validation & Error Messages

### T-5.1: Add field validation with suggestions [T]
- **File:** `src/services/field-normalizer.ts` (ENHANCE)
- **Dependencies:** T-1.1, T-2.1
- **Description:** Add optional validation that provides helpful error messages for unrecognized fields.

**Implementation details:**
1. Add `validateFields(fields, schemaFields)` function:
   - Uses `normalizeName()` for case-insensitive matching
   - Returns array of `FieldValidationError` objects
2. Add `findSimilarFields(fieldName, schemaFields)` helper:
   - Levenshtein distance or simple prefix matching
   - Returns top 3 closest matches
3. `FieldValidationError` interface:
   ```typescript
   { fieldName: string; message: string; suggestion?: string }
   ```
4. Integrate into node-builder with `--strict` or error-on-unknown option

**Error format:**
```
Field mapping error for supertag 'todo':
  - "Statsu" not found. Did you mean "⚙️ Status"?
  - "Priority" not found. Available fields: Due Date, ⚙️ Vault, ⚙️ Status
```

---

### T-5.2: Validation tests [T]
- **File:** `src/services/field-normalizer.test.ts` (EXTEND)
- **Dependencies:** T-5.1
- **Description:** Tests for field validation and suggestion logic.

**Test cases:**
1. Exact match returns no errors
2. Case mismatch suggests correct field
3. Typo suggests closest match (Levenshtein)
4. Unknown field with no match lists available fields
5. Empty schema fields list handled gracefully
6. Multiple errors returned together

---

## Group 6: Regression & Documentation

### T-6.1: Full regression test suite [T]
- **File:** Multiple existing test files
- **Dependencies:** T-2.1, T-3.1, T-4.1
- **Description:** Run full test suite to verify no regressions.

**Verification:**
1. `bun run test` passes (fast tests)
2. `bun run test:full` passes (all tests including slow)
3. `bun run typecheck` passes
4. Manual verification:
   - Existing CLI create with flat fields works
   - MCP tana_create with nested fields works
   - Error messages are clear for invalid fields

---

## Execution Order

```
Phase 1 (Foundation):
  T-1.1 ──┬──→ T-1.2
          │
Phase 2 (Node Builder):
          └──→ T-2.1 ──→ T-2.2
                │
Phase 3 (Integration):   ┌──→ T-3.1 ──→ T-3.2
                └────────┤
                         └──→ T-4.1
                              │
Phase 4 (Validation):        ┌┴─→ T-5.1 ──→ T-5.2
                             │
Phase 5 (Verification):      └──→ T-6.1
```

**Parallelization opportunities:**
- T-3.2 and T-4.1 can run in parallel (both depend on T-2.1)
- T-1.2 can be written alongside T-1.1

---

## Files Summary

| File | Action | Task |
|------|--------|------|
| `src/services/field-normalizer.ts` | NEW | T-1.1, T-5.1 |
| `src/services/field-normalizer.test.ts` | NEW | T-1.2, T-5.2 |
| `src/services/node-builder.ts` | MODIFY | T-2.1 |
| `src/services/node-builder.test.ts` | MODIFY | T-2.2 |
| `src/commands/create.ts` | MODIFY | T-3.1 |
| `tests/cli/create-fields.test.ts` | NEW | T-3.2 |
| `src/mcp/tools/create.test.ts` | MODIFY/NEW | T-4.1 |

---

## Success Criteria

| Criteria | Verification Method |
|----------|-------------------|
| MCP nested fields work | T-4.1 tests pass |
| CLI flat fields work | T-3.2 regression tests pass |
| CLI nested fields work | T-3.2 new format tests pass |
| Same output for both formats | T-4.1 equivalence test |
| Clear error messages | T-5.2 tests pass |
| All existing tests pass | T-6.1 full suite green |
| TypeScript types valid | `bun run typecheck` passes |
