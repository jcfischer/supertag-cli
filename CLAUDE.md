# Supertag CLI - Claude Code Context

## Documentation Locations

**When releasing a new version, update ALL of these:**

| File | Purpose | Location |
|------|---------|----------|
| `CHANGELOG.md` | Internal version history (detailed) | `./CHANGELOG.md` |
| `README.md` | Technical documentation, CLI usage, MCP setup | `./README.md` |
| `SKILL.md` | PAI skill documentation with USE WHEN triggers | `./SKILL.md` |
| `CHANGELOG.md` | Public release notes (customer-facing) | `~/work/web/invisible-store/tana/CHANGELOG.md` |
| `USER-GUIDE.md` | Customer-facing user guide | `~/work/web/invisible-store/tana/USER-GUIDE.md` |
| Marketing description | Store listing and marketing copy | `~/work/web/invisible-store/tana/index.html` |

## Release Checklist

**IMPORTANT: Update CHANGELOG.md BEFORE running release.sh**

1. Update `CHANGELOG.md` - Change `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`
2. Update version number in `package.json`
3. Run `bun run typecheck` - Ensure TypeScript type checks pass
4. Run `bun run test:full` - Ensure all tests pass
5. Run `./release.sh X.Y.Z --push` to build, tag, and push
6. Update public `CHANGELOG.md` at `~/work/web/invisible-store/tana/CHANGELOG.md`
7. Update store listing if features changed

**Note:** The release script updates `package.json` version automatically if you pass a version argument. Step 2 can be skipped if using `./release.sh X.Y.Z`.

## PR Checklist

**IMPORTANT: Run these checks before pushing a PR:**

1. Run `bun run typecheck` - TypeScript types must pass
2. Run `bun run test` - Fast tests must pass (1741+ tests)
3. Push and verify CI passes (GitHub Actions runs full test suite)

## Key Architecture

- **Main CLI**: `supertag` - query, write, sync, server, workspaces
- **Export CLI**: `supertag-export` - Playwright browser automation
- **MCP Server**: `supertag-mcp` - AI tool integration via Model Context Protocol

## Important Technical Notes

### Tana Input API Inline References

**Two ways to create references via Input API:**

1. **Inline reference in text** (within node name or child text):
   ```html
   <span data-inlineref-node="NODE_ID">Display Text</span>
   ```
   Example payload:
   ```json
   {"name": "Meeting with <span data-inlineref-node=\"abc123\">John Doe</span> today"}
   ```

2. **Child reference node** (entire child is a reference):
   ```json
   {"children": [{"dataType": "reference", "id": "NODE_ID"}]}
   ```

**IMPORTANT:** Do NOT end a node with an inline reference - always add text after the closing `</span>` tag.
- ✅ `"Meeting with <span data-inlineref-node=\"id\">John</span> today"`
- ❌ `"Meeting with <span data-inlineref-node=\"id\">John</span>"`

**Note:** Tana Paste syntax (`[[Node Name]]`, `[[text^id]]`) does NOT work in Input API - use the HTML span syntax above.

See `src/mcp/tools/create.ts` for implementation.

### Config Namespace
Uses `supertag` namespace (not `tana`) to avoid conflicts with official Tana app:
- Config: `~/.config/supertag/config.json`
- Data: `~/.local/share/supertag/`
- Cache: `~/.cache/supertag/`

### Export Format
Tana exports now wrap data in `storeData` object. The schema registry handles both formats.

### Export Location
Tana JSON exports are stored at: `~/Documents/Tana-Export/main/`
Files are named: `{workspaceId}@{date}.json` (e.g., `M9rkJkwuED@2025-12-12.json`)

### Entity Detection (_flags)
Based on Tana developer insights from Odin Urdland:
- **Entity flag**: `props._flags % 2 === 1` (LSB set = entity) - NOTE: uses `_flags` with underscore prefix
- **User override**: `props._entityOverride` (takes precedence if present)
- Entities are "interesting" nodes: tagged items, library items, "Create new" items
- Export contains ~13,735 entities with `_flags=1` out of 1.3M total nodes

**Entity Detection Priority** (in order):
1. `props._entityOverride` - Explicit user override (if true/false, use that)
2. `props._flags % 2 === 1` - Automatic entity flag from Tana
3. `props._ownerId.endsWith('_STASH')` - Library items (inferred)
4. Has tag in `tag_applications` table - Tagged items (inferred)

**Key Files:**
- `src/db/entity.ts` - Entity detection functions (`isEntity`, `isEntityById`, `findNearestEntityAncestor`)
- `src/types/tana-dump.ts` - Zod schema with `_flags` and `.passthrough()` to preserve props
- `tests/entity-detection.test.ts` - Comprehensive entity detection tests

### Field/Tuple Structures

Tana stores field values in tuple nodes. There are **two patterns**:

1. **Standard Field Tuples** (extracted ✅):
   - Parent → Tuple → [Label, Value1, Value2, ...]
   - May or may not have `_sourceId`
   - Up to 50 children

2. **Mega-Tuple Flat Structure** (not extracted ❌):
   - Single tuple with 50-1000+ children
   - Field labels: `"  - FieldName:"` (indentation in name)
   - Values: `"    - Value text"` (more indentation)
   - Labels and values are siblings, not parent-child
   - Used by daily briefings/AI features

**Key insight**: The `_sourceId` field is often missing on valid tuples. The `isFieldTuple()` function handles both cases.

**See**: `docs/TANA-FIELD-STRUCTURES.md` for full technical documentation.

### Content Filtering for Embeddings
When generating embeddings, content is filtered to focus on meaningful nodes:

**Default Filters** (`src/embeddings/content-filter.ts`):
- `minLength: 15` - Minimum 15 characters (but entities bypass this)
- `excludeTimestamps: true` - Exclude `1970-01-01...` artifacts
- `excludeSystemTypes: true` - Exclude system docTypes (tuple, metanode, viewDef, etc.)

**Important:** Entities bypass the minLength filter because short-named entities like "Animal #topic" are still meaningful. This ensures tagged items and library items always get embedded regardless of name length.

**CLI Options for `embed generate`:**
- `--min-length <n>` - Override minimum length (default: 15)
- `--include-all` - Bypass all content filters
- `--include-timestamps` - Include timestamp nodes
- `--include-system` - Include system docTypes
- `-t, --tag <tag>` - Only embed nodes with specific supertag

### Workspace Database Paths
- **Workspace DB**: `~/.local/share/supertag/workspaces/{alias}/tana-index.db`
- **Default workspace**: `main`
- **Full path**: `~/.local/share/supertag/workspaces/main/tana-index.db`

Always use the workspace-specific database, not the legacy path at `~/.local/share/supertag/tana-index.db`.

### Unified Workspace Resolver (Spec 052)

**ALWAYS use `resolveWorkspaceContext()` for workspace resolution** - never use `resolveWorkspace()` directly.

```typescript
import { resolveWorkspaceContext } from '../config/workspace-resolver';

// Basic usage - uses default workspace
const ws = resolveWorkspaceContext();
console.log(ws.dbPath);  // ~/.local/share/supertag/workspaces/main/tana-index.db

// Specific workspace
const ws = resolveWorkspaceContext({ workspace: 'books' });

// For commands that create databases (sync, export)
const ws = resolveWorkspaceContext({
  workspace: options.workspace,
  requireDatabase: false,  // Don't throw if database doesn't exist
});
```

**ResolvedWorkspace interface:**
```typescript
interface ResolvedWorkspace {
  alias: string;           // 'main', 'books', etc.
  config: WorkspaceConfig; // Full workspace config
  dbPath: string;          // Full path to SQLite database
  schemaPath: string;      // Full path to schema cache
  exportDir: string;       // Full path to export directory
  isDefault: boolean;      // Whether this is the default workspace
  nodeid?: string;         // Tana nodeid for API calls
  rootFileId: string;      // Tana rootFileId
}
```

**Error handling:**
- `WorkspaceNotFoundError` - Workspace alias not in configuration
- `WorkspaceDatabaseMissingError` - Database file doesn't exist (when `requireDatabase: true`)

**MCP cache clear:** Use `tana_cache_clear` tool or call `clearWorkspaceCache()` to refresh workspace data.

### Query Builder Utilities (Spec 055)

**ALWAYS use query builders for SQL construction** - never build LIMIT/OFFSET or ORDER BY manually.

```typescript
import { buildPagination, buildOrderBy, buildWhereClause } from '../db/query-builder';

// Pagination - returns { sql: "LIMIT ? OFFSET ?", params: [100, 0] }
const pagination = buildPagination({ limit: 100, offset: 0 });

// Order by - returns { sql: "ORDER BY created DESC", params: [] }
const orderBy = buildOrderBy({ sort: "created", direction: "DESC" }, []);

// Where clause - returns { sql: "WHERE status = ?", params: ["active"] }
const where = buildWhereClause([{ column: "status", operator: "=", value: "active" }]);
```

**Usage pattern with sqlParts array:**
```typescript
const sqlParts = ["SELECT * FROM nodes WHERE field_name = ?"];
const params: SQLQueryBindings[] = [fieldName];

// Add ORDER BY
const orderBy = buildOrderBy({ sort: "created", direction: "DESC" }, []);
sqlParts.push(orderBy.sql);

// Add pagination
const pagination = buildPagination({ limit, offset });
if (pagination.sql) {
  sqlParts.push(pagination.sql);
  params.push(...(pagination.params as SQLQueryBindings[]));
}

return db.query(sqlParts.join(" ")).all(...params);
```

**Available functions:**
- `buildPagination({ limit?, offset? })` - LIMIT/OFFSET with safe defaults
- `buildOrderBy({ sort, direction }, allowedColumns)` - ORDER BY with column whitelist validation
- `buildWhereClause(conditions)` - WHERE with =, !=, >, <, LIKE, IN, IS NULL operators
- `buildSelectQuery(options)` - Complete SELECT query composer

**Key files:**
- `src/db/query-builder.ts` - Implementation (53 tests, 108 assertions)
- Files using builders: `field-query.ts`, `field-values.ts`, `tana-query-engine.ts`, `search.ts`

**When NOT to use:**
- Simple IN clauses already embedded in template literals (e.g., `WHERE id IN (${placeholders})`) - these are already safe with parameterized queries

### Running from Source vs Binary
- **Binary**: `./supertag` - Compiled, may not have latest schema changes
- **Source**: `bun run src/index.ts` - Always has latest code

After schema changes (like adding `_flags` support), you must either:
1. Run from source: `bun run src/index.ts sync`
2. Rebuild binary: `./scripts/build.sh`

### Testing Workflow

**IMPORTANT: Use fast tests during development, full suite only before pushing.**

```bash
bun run test          # Fast tests only (~12s) - use during development
bun run test:full     # ALL tests (~200s) - run before pushing/releasing
bun run test:slow     # Slow tests only
```

**Do NOT run `bun test` directly** - it runs ALL tests including slow ones. Use `bun run test` instead.

The build script (`./scripts/build.sh`) runs fast tests automatically.

### Building After Implementation

**IMPORTANT: After implementing any code changes, rebuild the binary:**

```bash
./scripts/build.sh           # Build if source changed (runs fast tests first)
./scripts/build.sh --force   # Force rebuild
./scripts/build.sh --check   # Check if rebuild needed
```

The build script:
1. Runs fast tests first (fails build if tests fail)
2. Only rebuilds if source files changed (unless --force)
3. Compiles to standalone `supertag` binary

### Error Handling System (Spec 073)

**Structured Errors** - All errors extend `StructuredError` with consistent structure:

```typescript
import { StructuredError } from '../utils/structured-errors';

// Creating errors
throw new StructuredError("WORKSPACE_NOT_FOUND", "Workspace 'test' not found", {
  details: { requestedWorkspace: "test", availableWorkspaces: ["main"] },
  suggestion: "Try one of: main",
  recovery: { canRetry: false, alternatives: ["main"] },
});

// For workspace errors, use specialized classes:
import { WorkspaceNotFoundError, WorkspaceDatabaseMissingError } from '../config/workspace-resolver';
throw new WorkspaceNotFoundError("test", ["main", "books"]);
throw new WorkspaceDatabaseMissingError("test", "/path/to/db");
```

**Error Codes:**
- `WORKSPACE_NOT_FOUND` - Workspace alias not in config
- `DATABASE_NOT_FOUND` - Database file missing
- `TAG_NOT_FOUND` - Supertag doesn't exist
- `NODE_NOT_FOUND` - Node ID not found
- `API_ERROR` - Tana API request failed
- `VALIDATION_ERROR` - Input validation failed
- `CONFIG_NOT_FOUND` - Config file missing
- `UNKNOWN_ERROR` - Unclassified error

**Formatting for different contexts:**

```typescript
import { formatErrorForCli, formatErrorForMcp } from '../utils/error-formatter';

// CLI output (human-readable with colors)
console.error(formatErrorForCli(error));

// MCP output (structured JSON for AI agents)
return { error: formatErrorForMcp(error) };
```

**Debug mode:**

```typescript
import { isDebugMode, setDebugMode, formatDebugError } from '../utils/debug';

// Enable debug mode (shows stack traces)
setDebugMode(true);

// Format with debug info when in debug mode
console.error(formatDebugError(error));
```

**MCP error handling:**

```typescript
import { handleMcpError } from '../mcp/error-handler';

try {
  const result = await someOperation();
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
} catch (error) {
  return handleMcpError(error);  // Returns { isError: true, content: [...] }
}
```

**Key files:**
- `src/utils/structured-errors.ts` - StructuredError class
- `src/utils/error-formatter.ts` - CLI and MCP formatters
- `src/utils/error-registry.ts` - Error code registry
- `src/utils/debug.ts` - Debug mode utilities
- `src/mcp/error-handler.ts` - MCP error handling
- `src/config/workspace-resolver.ts` - Workspace error classes
