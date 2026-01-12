# F-001: Fix Inline Reference Truncation - Technical Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Current Architecture                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Tana Export JSON                                                           │
│        │                                                                    │
│        ▼                                                                    │
│  ┌─────────────────┐    ✅ Correct                                         │
│  │ tana-export.ts  │    Uses .matchAll() - extracts ALL references         │
│  │ extractInlineRefs│                                                       │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │   SQLite DB     │    Stores complete field values with all refs         │
│  │  (field_values) │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │              Display Layer (THE BUG IS HERE)                    │       │
│  │                                                                 │       │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │       │
│  │  │ tana-show.ts  │  │   show.ts     │  │   node.ts     │       │       │
│  │  │ formatValue() │  │ formatValue() │  │ formatValue() │       │       │
│  │  │     ❌        │  │      ❌       │  │      ❌       │       │       │
│  │  │ .match()      │  │   .match()    │  │   .match()    │       │       │
│  │  │ (first only)  │  │ (first only)  │  │ (first only)  │       │       │
│  │  └───────────────┘  └───────────────┘  └───────────────┘       │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Root Cause Analysis

The bug exists in **three duplicate implementations** of `formatValue()` that use `.match()` instead of `.matchAll()`:

| File | Lines | Current (Buggy) | Should Use |
|------|-------|-----------------|------------|
| `src/cli/tana-show.ts` | 238-265 | `.match()` (first) | `.matchAll()` (all) |
| `src/commands/show.ts` | 110-134 | `.match()` (first) | `.matchAll()` (all) |
| `src/mcp/tools/node.ts` | 77-101 | `.match()` (first) | `.matchAll()` (all) |

**Current buggy code pattern:**
```typescript
if (name.includes("data-inlineref-node")) {
  const match = name.match(/data-inlineref-node="([^"]+)"/);
  if (match) {
    return `[[${match[1]}]]`;  // Returns ONLY first reference
  }
}
```

**Correct pattern (from `src/db/transcript.ts`):**
```typescript
const nodePattern = /<span\s+data-inlineref-node="[^"]*"[^>]*>([^<]*)<\/span>/g;
text = text.replace(nodePattern, (_, content) => content || "");  // ALL references
```

## Technology Stack

- **Language:** TypeScript (existing codebase standard)
- **Runtime:** Bun (existing codebase standard)
- **Testing:** Bun test framework (existing)
- **Regex:** ES2018+ `matchAll()` with global flag

## Solution Design

### Approach: Centralized Utility Function

Create a single, well-tested utility function to replace the three duplicate implementations. This ensures:
1. Single source of truth for inline reference formatting
2. Consistent behavior across CLI and MCP
3. Easy testing and maintenance

### New Utility Function

**Location:** `src/utils/inline-ref-formatter.ts`

```typescript
/**
 * Format inline references in a field value string.
 * Handles both node references and date references.
 *
 * @param value - Raw field value potentially containing inline refs
 * @param options - Formatting options
 * @returns Formatted string with all inline references processed
 */
export function formatInlineRefs(
  value: string | null | undefined,
  options?: FormatInlineRefOptions
): string;

interface FormatInlineRefOptions {
  /** Format for node refs: 'bracket' for [[id]], 'display' for display text */
  nodeRefFormat?: 'bracket' | 'display';
  /** Fallback when value is null/undefined */
  fallback?: string;
}
```

### Algorithm

```
INPUT: "Meeting with <span data-inlineref-node="abc123">John</span> and <span data-inlineref-node="def456">Jane</span> today"

1. Check for null/undefined → return fallback or empty string
2. Process date references first (preserve order):
   - Pattern: /<span\s+data-inlineref-date="([^"]+)"[^>]*>([^<]*)<\/span>/g
   - Extract dateTimeString from JSON, format as date
3. Process node references:
   - Pattern: /<span\s+data-inlineref-node="([^"]+)"[^>]*>([^<]*)<\/span>/g
   - Replace with [[nodeId]] or display text based on options
4. Return processed string

OUTPUT (bracket mode): "Meeting with [[abc123]] and [[def456]] today"
OUTPUT (display mode): "Meeting with John and Jane today"
```

## Data Model

No database schema changes required. The database already stores complete field values - truncation occurs only at display time.

**Existing field_values schema (unchanged):**
```sql
CREATE TABLE field_values (
  node_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value_id TEXT NOT NULL,
  value_name TEXT,          -- Contains full inline ref HTML
  field_id TEXT,
  display_order INTEGER,
  ...
);
```

## API Contracts

No external API changes. Internal function signature:

```typescript
// New utility (src/utils/inline-ref-formatter.ts)
export function formatInlineRefs(
  value: string | null | undefined,
  options?: FormatInlineRefOptions
): string;

export interface FormatInlineRefOptions {
  nodeRefFormat?: 'bracket' | 'display';
  fallback?: string;
}
```

## Implementation Phases

### Phase 1: Create Shared Utility (30 min)
1. Create `src/utils/inline-ref-formatter.ts` with `formatInlineRefs()` function
2. Write comprehensive unit tests covering:
   - No references (plain text)
   - Single reference
   - Multiple references
   - Adjacent references (no text between)
   - References only (no surrounding text)
   - Date references
   - Mixed node + date references
   - Empty display text
   - HTML entity encoding

### Phase 2: Update CLI Files (15 min)
1. Update `src/cli/tana-show.ts`:
   - Import `formatInlineRefs` from utility
   - Replace `formatValue()` to use `formatInlineRefs()`
2. Update `src/commands/show.ts`:
   - Import and use `formatInlineRefs()`
3. Verify existing tests still pass

### Phase 3: Update MCP Tool (15 min)
1. Update `src/mcp/tools/node.ts`:
   - Import and use `formatInlineRefs()`
2. Test MCP server with multi-reference values

### Phase 4: Integration Testing (30 min)
1. Add integration tests for CLI output
2. Add integration tests for MCP output
3. Test with real Tana export data if available
4. Run full test suite

### Phase 5: Cleanup (10 min)
1. Remove duplicate `formatValue()` implementations
2. Update documentation if needed
3. Run `bun run typecheck` and `bun run test:full`

## File Structure

```
src/
├── utils/
│   ├── inline-ref-formatter.ts     # NEW: Shared utility
│   └── format.ts                   # Existing (no changes)
├── cli/
│   └── tana-show.ts               # UPDATE: Use formatInlineRefs
├── commands/
│   └── show.ts                    # UPDATE: Use formatInlineRefs
└── mcp/
    └── tools/
        └── node.ts                # UPDATE: Use formatInlineRefs

tests/
├── unit/
│   └── inline-ref-formatter.test.ts  # NEW: Unit tests
└── integration/
    └── inline-ref-display.test.ts    # NEW: Integration tests
```

## Dependencies

No new external dependencies required. Uses only:
- Built-in JavaScript regex (`matchAll`, `replace`)
- Existing Bun test framework

## Risk Assessment

### Low Risk
- **Backward Compatibility:** Single-reference values will behave identically to before
- **Performance:** Linear time complexity O(n) where n = string length; negligible impact
- **Test Coverage:** Existing test infrastructure supports the change

### Mitigations
| Risk | Mitigation |
|------|------------|
| Regex edge cases | Comprehensive unit tests for all edge cases in spec |
| Breaking existing behavior | Run full test suite before merging |
| Three files need updating | Single utility function reduces chance of inconsistency |

## Success Criteria

1. **Unit Tests Pass:** All test cases from FR-4 (edge cases table) pass
2. **Integration Tests Pass:** CLI and MCP return same output for multi-reference values
3. **Existing Tests Pass:** `bun run test:full` succeeds
4. **Manual Verification:** Real Tana data with multi-reference fields displays correctly

## Test Cases (from Spec)

| Case | Input | Expected Output |
|------|-------|-----------------|
| No references | `"Plain text"` | `"Plain text"` |
| Single reference | `"Hello <span data-inlineref-node=\"id1\">John</span>"` | `"Hello [[id1]]"` |
| Multiple references | `"With <span data-inlineref-node=\"id1\">A</span> and <span data-inlineref-node=\"id2\">B</span>"` | `"With [[id1]] and [[id2]]"` |
| Adjacent references | `"<span data-inlineref-node=\"id1\">A</span><span data-inlineref-node=\"id2\">B</span>"` | `"[[id1]][[id2]]"` |
| References only | `"<span data-inlineref-node=\"id1\">X</span>"` | `"[[id1]]"` |
| Empty display text | `"<span data-inlineref-node=\"id1\"></span>"` | `"[[id1]]"` |
| Date reference | `"Due: <span data-inlineref-date=\"{...}\">2026-01-14</span>"` | `"Due: 2026-01-14"` |

## Estimated Effort

Total: ~2 hours of implementation and testing
- Phase 1 (utility + tests): 30 min
- Phase 2 (CLI update): 15 min
- Phase 3 (MCP update): 15 min
- Phase 4 (integration tests): 30 min
- Phase 5 (cleanup + verification): 30 min
