# Tasks: Spec 087 - Query Name Contains Operator

## Task List

- [ ] **T-1** Add contains prefix parsing to `convertInputToAST` [T]
- [ ] **T-2** Add unit tests for prefix parsing [T]
- [ ] **T-3** Verify integration with real database [T]
- [ ] **T-4** Rebuild MCP binary

## Task Details

### T-1: Add contains prefix parsing

**File:** `src/mcp/tools/query.ts`
**Lines:** 30-35

Modify shorthand string handling to detect `~` prefix.

### T-2: Add unit tests

**File:** `src/mcp/tools/__tests__/query.test.ts`

Test cases:
- Contains shorthand `~value`
- Escaped tilde `\~value`
- Plain string (unchanged)
- Number value (unchanged)

### T-3: Integration test

Verify query works against real database:
```bash
supertag query person --where 'name=~Katja' --json
```

### T-4: Rebuild MCP binary

```bash
bun run build:mcp
```
