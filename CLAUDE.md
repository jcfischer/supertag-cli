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
3. Run `bun run test:full` - Ensure all tests pass
4. Run `./release.sh X.Y.Z --push` to build, tag, and push
5. Update public `CHANGELOG.md` at `~/work/web/invisible-store/tana/CHANGELOG.md`
6. Update store listing if features changed

**Note:** The release script updates `package.json` version automatically if you pass a version argument. Step 2 can be skipped if using `./release.sh X.Y.Z`.

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

### Running from Source vs Binary
- **Binary**: `./supertag` - Compiled, may not have latest schema changes
- **Source**: `bun run src/index.ts` - Always has latest code

After schema changes (like adding `_flags` support), you must either:
1. Run from source: `bun run src/index.ts sync`
2. Rebuild binary: `./scripts/build.sh`

### Building After Implementation

**IMPORTANT: After implementing any code changes, rebuild the binary:**

```bash
./scripts/build.sh           # Build if source changed (runs tests first)
./scripts/build.sh --force   # Force rebuild
./scripts/build.sh --check   # Check if rebuild needed
```

The build script:
1. Runs tests first (fails build if tests fail)
2. Only rebuilds if source files changed (unless --force)
3. Compiles to standalone `supertag` binary
