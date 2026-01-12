# F-001: Fix Inline Reference Truncation - Tasks

## Progress Tracking

| Task | Description | Status | Blocked By |
|------|-------------|--------|------------|
| T-1.1 | Create formatInlineRefs utility | ✅ | - |
| T-1.2 | Write unit tests for formatInlineRefs | ✅ | T-1.1 |
| T-2.1 | Update src/cli/tana-show.ts | ✅ | T-1.2 |
| T-2.2 | Update src/commands/show.ts | ✅ | T-1.2 |
| T-2.3 | Update src/mcp/tools/node.ts | ✅ | T-1.2 |
| T-3.1 | Write integration tests | ⏭️ Skipped | T-2.1, T-2.2, T-2.3 |
| T-3.2 | Remove duplicate formatValue functions | ✅ | T-3.1 |
| T-4.1 | Final verification and cleanup | ✅ | T-3.2 |

Legend: ⬜ Pending | 🔄 In Progress | ✅ Complete | ❌ Blocked | ⏭️ Skipped

---

## Group 1: Foundation

### T-1.1: Create formatInlineRefs utility [T]
- **File:** `src/utils/inline-ref-formatter.ts`
- **Test:** `tests/utils/inline-ref-formatter.test.ts`
- **Dependencies:** none

**Implementation:**
1. Create new file `src/utils/inline-ref-formatter.ts`
2. Define `FormatInlineRefOptions` interface:
   ```typescript
   export interface FormatInlineRefOptions {
     nodeRefFormat?: 'bracket' | 'display';
     fallback?: string;
   }
   ```
3. Implement `formatInlineRefs(value: string | null | undefined, options?: FormatInlineRefOptions): string`
4. Handle null/undefined inputs → return fallback or empty string
5. Process date references using global regex with `replace()`:
   - Pattern: `/<span\s+data-inlineref-date="([^"]+)"[^>]*>([^<]*)<\/span>/g`
   - Decode HTML entities first (`&quot;`, `&amp;`, `&lt;`, `&gt;`)
   - Extract `dateTimeString` from JSON, return date portion
6. Process node references using global regex with `replace()`:
   - Pattern: `/<span\s+data-inlineref-node="([^"]+)"[^>]*>([^<]*)<\/span>/g`
   - Replace with `[[nodeId]]` (bracket mode) or display text (display mode)
7. Return processed string preserving all surrounding text

**Acceptance Criteria:**
- Function handles all edge cases from spec FR-4
- Exports both function and interface
- No external dependencies

---

### T-1.2: Write unit tests for formatInlineRefs [T]
- **File:** `tests/utils/inline-ref-formatter.test.ts`
- **Dependencies:** T-1.1

**Test Cases (from spec):**

| Test | Input | Expected |
|------|-------|----------|
| No references | `"Plain text"` | `"Plain text"` |
| Single node ref | `"Hello <span data-inlineref-node=\"id1\">John</span>"` | `"Hello [[id1]]"` |
| Multiple node refs | `"With <span data-inlineref-node=\"id1\">A</span> and <span data-inlineref-node=\"id2\">B</span>"` | `"With [[id1]] and [[id2]]"` |
| Adjacent refs | `"<span data-inlineref-node=\"id1\">A</span><span data-inlineref-node=\"id2\">B</span>"` | `"[[id1]][[id2]]"` |
| Refs only | `"<span data-inlineref-node=\"id1\">X</span>"` | `"[[id1]]"` |
| Empty display text | `"<span data-inlineref-node=\"id1\"></span>"` | `"[[id1]]"` |
| Null input | `null` | `""` |
| Undefined input | `undefined` | `""` |
| With fallback | `null, { fallback: "N/A" }` | `"N/A"` |
| Display mode | `"<span data-inlineref-node=\"id1\">John</span>"`, `{ nodeRefFormat: 'display' }` | `"John"` |
| Date reference | `"Due: <span data-inlineref-date=\"{&quot;dateTimeString&quot;:&quot;2026-01-14&quot;}\">Jan 14</span>"` | `"Due: 2026-01-14"` |
| Mixed refs | `"<span data-inlineref-node=\"id1\">A</span> by <span data-inlineref-date=\"...\">Jan 1</span>"` | `"[[id1]] by 2026-01-01"` |
| HTML entities | Encoded `&quot;`, `&amp;`, `&lt;`, `&gt;` | Properly decoded |
| Three+ refs | `"<span...>A</span>, <span...>B</span>, <span...>C</span>"` | `"[[a]], [[b]], [[c]]"` |

**Acceptance Criteria:**
- All 14+ test cases pass
- Tests are isolated (no database or file dependencies)
- Run with `bun test tests/utils/inline-ref-formatter.test.ts`

---

## Group 2: Core Updates [P]

Tasks T-2.1, T-2.2, and T-2.3 can be done in parallel after T-1.2 passes.

### T-2.1: Update src/cli/tana-show.ts [T]
- **File:** `src/cli/tana-show.ts` (lines 238-265)
- **Test:** Existing tests + `tests/commands/tana-show-refs.test.ts`
- **Dependencies:** T-1.2

**Implementation:**
1. Add import at top of file:
   ```typescript
   import { formatInlineRefs } from '../utils/inline-ref-formatter';
   ```
2. Replace `formatValue()` function (lines 238-265) with:
   ```typescript
   function formatValue(name: string | null | undefined, id: string): string {
     if (!name) return id;
     return formatInlineRefs(name, { fallback: id });
   }
   ```
3. Run existing tests: `bun test tests/commands/` to verify no regressions

**Acceptance Criteria:**
- `formatValue()` delegates to shared utility
- All existing tests pass
- Multi-reference values display correctly in CLI

---

### T-2.2: Update src/commands/show.ts [T]
- **File:** `src/commands/show.ts` (lines 110-134)
- **Test:** Existing tests + verification
- **Dependencies:** T-1.2

**Implementation:**
1. Add import at top of file:
   ```typescript
   import { formatInlineRefs } from '../utils/inline-ref-formatter';
   ```
2. Replace `formatValue()` function (lines 110-134) with:
   ```typescript
   function formatValue(name: string | null | undefined, id: string): string {
     if (!name) return id;
     return formatInlineRefs(name, { fallback: id });
   }
   ```
3. Run existing tests to verify no regressions

**Acceptance Criteria:**
- `formatValue()` delegates to shared utility
- All existing tests pass
- Consistent behavior with T-2.1

---

### T-2.3: Update src/mcp/tools/node.ts [T]
- **File:** `src/mcp/tools/node.ts` (lines 77-101)
- **Test:** `tests/mcp/node-refs.test.ts`
- **Dependencies:** T-1.2

**Implementation:**
1. Add import at top of file:
   ```typescript
   import { formatInlineRefs } from '../../utils/inline-ref-formatter';
   ```
2. Replace `formatValue()` function (lines 77-101) with:
   ```typescript
   function formatValue(name: string | null | undefined, id: string): string {
     if (!name) return id;
     return formatInlineRefs(name, { fallback: id });
   }
   ```
3. Run MCP tests: `bun test tests/mcp/`

**Acceptance Criteria:**
- `formatValue()` delegates to shared utility
- All MCP tests pass
- MCP `tana_node_show` returns all inline refs

---

## Group 3: Integration & Cleanup

### T-3.1: Write integration tests [T]
- **File:** `tests/integration/inline-ref-display.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-2.3

**Test Scenarios:**

1. **CLI output consistency:**
   - Create mock node with multi-reference field value
   - Verify `nodes show` command outputs all references

2. **MCP output consistency:**
   - Call `tana_node_show` with multi-reference field
   - Verify JSON response contains all references

3. **Cross-channel consistency:**
   - Same input produces same formatted output in CLI and MCP

**Acceptance Criteria:**
- Integration tests cover all three user scenarios from spec
- Tests can run against mock/test database
- All integration tests pass

---

### T-3.2: Remove duplicate formatValue functions
- **Files:**
  - `src/cli/tana-show.ts`
  - `src/commands/show.ts`
  - `src/mcp/tools/node.ts`
- **Dependencies:** T-3.1

**Implementation:**
1. Verify all three files now use the shared utility
2. Optionally inline the one-liner if it's just `formatInlineRefs(name, { fallback: id })`
3. Ensure no dead code remains
4. Run `bun run typecheck` to verify no type errors

**Acceptance Criteria:**
- No duplicate implementations of inline ref formatting
- Code is DRY (Don't Repeat Yourself)
- TypeScript compiles without errors

---

## Group 4: Verification

### T-4.1: Final verification and cleanup [T]
- **Dependencies:** T-3.2

**Verification Steps:**
1. Run `bun run typecheck` - must pass
2. Run `bun run test` (fast tests) - must pass
3. Run `bun run test:full` (all tests) - must pass
4. Manual test with real Tana data if available:
   - Find a node with multiple inline references
   - Run `supertag nodes show <id>`
   - Verify all references display
5. Rebuild binary: `./scripts/build.sh`
6. Test binary output matches source output

**Acceptance Criteria:**
- All automated tests pass
- Binary builds successfully
- Manual verification confirms fix works
- Ready for release

---

## Execution Order

```
T-1.1 (utility)
    │
    ▼
T-1.2 (unit tests)
    │
    ├──────────┬──────────┐
    ▼          ▼          ▼
  T-2.1      T-2.2      T-2.3    [PARALLEL]
  (tana-show) (show)    (node)
    │          │          │
    └──────────┴──────────┘
               │
               ▼
           T-3.1 (integration tests)
               │
               ▼
           T-3.2 (cleanup)
               │
               ▼
           T-4.1 (verification)
```

## Files Modified

| File | Change Type | Task |
|------|-------------|------|
| `src/utils/inline-ref-formatter.ts` | NEW | T-1.1 |
| `tests/utils/inline-ref-formatter.test.ts` | NEW | T-1.2 |
| `src/cli/tana-show.ts` | MODIFY | T-2.1 |
| `src/commands/show.ts` | MODIFY | T-2.2 |
| `src/mcp/tools/node.ts` | MODIFY | T-2.3 |
| `tests/integration/inline-ref-display.test.ts` | NEW | T-3.1 |

## Notes

- Tasks marked [T] require tests to be written or verified
- Tasks marked [P] can be executed in parallel
- Run fast tests (`bun run test`) during development
- Run full test suite (`bun run test:full`) before marking complete
- See `CLAUDE.md` section "Testing Workflow" for test commands
