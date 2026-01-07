# Plan: Spec 087 - Query Name Contains Operator

## Architecture Decision

**Approach:** Minimal change to `convertInputToAST` function in MCP tool.

**Rationale:**
- The query engine already handles `~` operator correctly (verified in `unified-query-engine.ts` lines 294-297)
- Only the MCP input parsing needs fixing
- CLI uses the same code path via MCP tools

**Alternative considered:** Add prefix parsing to all operators (`>`, `<`, `!`, etc.)
- Rejected: YAGNI - only `~` is needed now; can extend later

## Implementation Design

### Change Location

**File:** `src/mcp/tools/query.ts`
**Function:** `convertInputToAST`
**Lines:** 30-35

### Current Code

```typescript
// Shorthand: string/number value means equality
if (typeof condition === "string" || typeof condition === "number") {
  clauses.push({ field, operator: "=", value: condition });
  continue;
}
```

### New Code

```typescript
// Shorthand: string/number value
if (typeof condition === "string" || typeof condition === "number") {
  if (typeof condition === "string" && condition.startsWith("~")) {
    // Contains operator shorthand: "~value" means contains "value"
    clauses.push({ field, operator: "~", value: condition.slice(1) });
  } else if (typeof condition === "string" && condition.startsWith("\\~")) {
    // Escaped tilde: "\~value" means literal "~value"
    clauses.push({ field, operator: "=", value: condition.slice(1) });
  } else {
    clauses.push({ field, operator: "=", value: condition });
  }
  continue;
}
```

## Test Plan

### Unit Tests

**File:** `src/mcp/tools/__tests__/query.test.ts` (create if not exists)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Contains shorthand | `{ name: "~Katja" }` | `{ field: "name", operator: "~", value: "Katja" }` |
| Escaped tilde | `{ name: "\\~special" }` | `{ field: "name", operator: "=", value: "~special" }` |
| Plain string | `{ name: "Katja" }` | `{ field: "name", operator: "=", value: "Katja" }` |
| Number value | `{ count: 5 }` | `{ field: "count", operator: "=", value: 5 }` |
| Object syntax still works | `{ name: { contains: "Katja" } }` | `{ field: "name", operator: "~", value: "Katja" }` |

### Integration Test

**File:** `src/mcp/tools/__tests__/query.integration.test.ts`

```typescript
test("finds #person by partial name", async () => {
  const result = await query({
    find: "person",
    where: { name: "~Katja" },
    limit: 10
  });

  expect(result.results.length).toBeGreaterThan(0);
  expect(result.results[0].name).toContain("Katja");
});
```

## Failure Mode Analysis

| Failure Mode | Likelihood | Impact | Mitigation |
|--------------|------------|--------|------------|
| Breaks existing queries | Low | High | Existing object syntax unchanged; only new prefix behavior |
| User has node name starting with `~` | Very Low | Low | Escape syntax `\~` available |
| Performance regression | None | N/A | No additional DB queries; just string parsing |

## Rollback Plan

Revert single file change: `git checkout HEAD~1 -- src/mcp/tools/query.ts`

## Dependencies

- None - self-contained change

## Estimated Complexity

- **Lines changed:** ~10
- **Files changed:** 1 (+ 1 test file)
- **Risk:** Low
