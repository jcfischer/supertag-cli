# Spec 087: Query Name Contains Operator

## Problem Statement

When using `tana_query` to find nodes by tag AND partial name match, the contains operator (`~`) is not recognized in string shorthand values.

**Current behavior:**
```json
// Input
{ "find": "person", "where": { "name": "~Katja" } }

// Parsed as
{ "field": "name", "operator": "=", "value": "~Katja" }  // WRONG

// Expected
{ "field": "name", "operator": "~", "value": "Katja" }   // CORRECT
```

**Impact:** Cannot search for `#person` nodes by partial name. This forces users to:
1. Fetch ALL nodes with a tag (inefficient)
2. Use `tana_search` which doesn't filter by tag
3. Manually filter results

**Real-world example:** Finding BDCM meeting attendees who have `#person` entries. Katja Dörlemann exists as `#person` node `Ikpz7cE1ka9f`, but `tana_query` couldn't find her.

## User Journey

1. User wants to find a person by partial name: "Find the #person node for Katja"
2. User calls `tana_query` with `find: "person"` and `where: { name: "~Katja" }`
3. **Expected:** Returns the `#person` node for "Katja Dörlemann"
4. **Actual:** Returns empty (no match for literal "~Katja")

## Root Cause

In `src/mcp/tools/query.ts`, the `convertInputToAST` function at lines 30-35:

```typescript
// Shorthand: string/number value means equality
if (typeof condition === "string" || typeof condition === "number") {
  clauses.push({ field, operator: "=", value: condition });
  continue;
}
```

The shorthand path treats ALL string values as equality, ignoring the `~` prefix convention.

## Requirements

### FR-1: Parse `~` prefix as contains operator
When a string value starts with `~`, interpret it as the contains operator:
- Input: `{ "name": "~Katja" }`
- Parsed as: `{ field: "name", operator: "~", value: "Katja" }`

### FR-2: Preserve existing object syntax
The full object syntax must continue to work:
- `{ "name": { "contains": "Katja" } }` → contains operator

### FR-3: Support escaping literal tilde
If someone wants to search for a literal `~` at the start:
- `{ "name": "\\~special" }` → equality with value `~special`

### FR-4: Apply to MCP tool AND CLI
Both `tana_query` MCP tool and `supertag query` CLI command must support this.

## Success Criteria

1. `tana_query` with `{ find: "person", where: { name: "~Katja" } }` returns the #person node for "Katja Dörlemann"
2. Existing queries with object syntax continue to work
3. All existing tests pass
4. New tests cover the `~` prefix shorthand

## Assumptions

| Assumption | Invalidation Condition |
|------------|------------------------|
| `~` prefix is not commonly used in node names | User reports needing to search for names starting with ~ |
| Only `~` prefix is needed (not `>`, `<`, etc.) | User requests other operator prefixes |

## Out of Scope

- Other operator prefixes (`>`, `<`, `!`) - can be added later if needed
- Regex support in name matching
- Case-insensitive matching (separate feature)

## Technical Notes

**File to modify:** `src/mcp/tools/query.ts`

**Change location:** `convertInputToAST` function, lines 30-35

**Proposed fix:**
```typescript
if (typeof condition === "string" || typeof condition === "number") {
  if (typeof condition === "string" && condition.startsWith("~")) {
    // Contains operator shorthand
    clauses.push({ field, operator: "~", value: condition.slice(1) });
  } else if (typeof condition === "string" && condition.startsWith("\\~")) {
    // Escaped tilde - literal match
    clauses.push({ field, operator: "=", value: condition.slice(1) });
  } else {
    clauses.push({ field, operator: "=", value: condition });
  }
  continue;
}
```

## References

- Spec 063: Unified Query Language (defines query syntax)
- `src/query/unified-query-engine.ts` - handles `~` operator correctly at SQL level
