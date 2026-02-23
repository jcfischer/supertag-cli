# F-100: Entity Resolution

## Summary

Entity resolution adds a find-or-create primitive to supertag-cli. Before creating a node in Tana, AI agents and automation pipelines can check if a matching node already exists using a multi-strategy matching pipeline: exact (case-insensitive), fuzzy (FTS5 + Levenshtein distance), and semantic (vector similarity via embeddings). Each candidate gets a confidence score (0.0-1.0), and the result action (`matched`, `ambiguous`, `no_match`) tells callers whether to reuse an existing node or create a new one.

No new dependencies were added — the feature combines existing FTS5, `fastest-levenshtein`, and `resona` (LanceDB) infrastructure.

## Resolution Pipeline

```
Input (name, --tag?, --threshold?, --exact?)
  → Normalize (lowercase, trim, remove punctuation, preserve Unicode)
  → Generate name variants ("Last, First" ↔ "First Last")
  → Exact Match (confidence 1.0)
  → Fuzzy Match: FTS5 + LIKE + Levenshtein scoring (confidence 0.0-0.95)
  → Semantic Match: cosine similarity via embeddings (confidence 0.0-0.95, optional)
  → Merge & deduplicate (highest confidence per node ID)
  → Filter by threshold + tag
  → Determine action: matched | ambiguous | no_match
```

**Confidence scoring:**
- Exact match: always 1.0
- Fuzzy: `1.0 - (levenshtein_distance / max_length)`, boosted +0.10 if tag matches, +0.05 if entity. Capped at 0.95.
- Semantic: cosine similarity < 0.5 maps to 0; 0.5-1.0 maps linearly to 0-0.95.
- Ambiguity: if multiple candidates are above threshold and the gap between top two is < 0.1, action is `ambiguous`.

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `src/lib/entity-resolution.ts` | Core types, pure functions: normalization, fuzzy confidence, semantic mapping, merge/dedup, action determination, name variant generation, FTS5 escaping, short query validation |
| `src/db/entity-match.ts` | Database layer: `findExactMatches()`, `findFuzzyMatches()`, `findSemanticMatches()`, and `resolveEntity()` orchestrator |
| `src/commands/resolve.ts` | CLI command: `supertag resolve <name>` with all options and output formatting |
| `src/mcp/tools/resolve.ts` | MCP tool handler: `tana_resolve` implementation |
| `tests/entity-resolution.test.ts` | Unit tests for core pure functions (416 lines) |
| `tests/entity-match.test.ts` | Integration tests for database matching (263 lines) |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Register `resolve` command with main CLI |
| `src/mcp/index.ts` | Register `tana_resolve` tool in MCP dispatcher |
| `src/mcp/schemas.ts` | Add `resolveSchema` Zod schema for MCP input validation |
| `src/mcp/tool-mode.ts` | Add `tana_resolve` to `query` mode (available in all modes including lite) |
| `src/mcp/tool-registry.ts` | Add `tana_resolve` metadata entry |
| `tests/mcp-lite-mode.test.ts` | Update expected tool count to include `tana_resolve` |
| `tests/unit/mcp-tool-mode-integration.test.ts` | Update tool count assertions |
| `tests/unit/tool-mode.test.ts` | Update tool count assertions |

## CLI Usage

```bash
# Basic resolution
supertag resolve "Daniel Miessler"

# Filter by supertag
supertag resolve "Daniel Miessler" --tag person

# Exact match only (no fuzzy/semantic)
supertag resolve "Daniel Miessler" --exact

# Custom threshold and limit
supertag resolve "Daniel" --threshold 0.9 --limit 3

# Batch mode from stdin
echo -e "Daniel Miessler\nJohn Doe" | supertag resolve --batch --tag person --format json

# Create suggestion if no match
supertag resolve "New Person" --tag person --create-if-missing

# Output formats: table (default), json, csv, ids, jsonl, minimal
supertag resolve "Meeting notes" --format csv
```

**Short query protection:** Queries under 3 characters require `--exact` or `--tag` to prevent false positives.

## MCP Tool

Tool name: `tana_resolve`
Mode: `query` (available in all modes including lite)

```json
{
  "name": "Daniel Miessler",
  "tag": "person",
  "threshold": 0.85,
  "limit": 5,
  "exact": false,
  "createIfMissing": false,
  "workspace": "main"
}
```

Response:

```json
{
  "query": "Daniel Miessler",
  "action": "matched",
  "candidates": [
    {
      "id": "abc123",
      "name": "Daniel Miessler",
      "tags": ["person"],
      "confidence": 1.0,
      "matchType": "exact"
    }
  ],
  "bestMatch": { "id": "abc123", "name": "Daniel Miessler", "confidence": 1.0 },
  "embeddingsAvailable": false
}
```

When `createIfMissing` is true and no match is found, the response includes a `created.suggestion` field with a command to create the node. Ambiguous matches refuse to suggest creation.

## Configuration

No new configuration needed. The feature uses:
- Existing workspace database (`~/.local/share/supertag/workspaces/{alias}/tana-index.db`)
- Existing FTS5 index (`nodes_fts` table)
- Existing embeddings (optional, at `{workspace}/embeddings/`)
- Existing `fastest-levenshtein` and `resona` packages

## Key Design Decisions

- **Graceful degradation:** Semantic search is optional. If no embeddings exist, fuzzy-only mode runs with a note in output.
- **No auto-creation:** `--create-if-missing` only prints a suggestion; it never creates nodes automatically. Ambiguous matches explicitly refuse.
- **Name variants:** "Last, First" and "First Last" are both tried, preventing missed matches on name ordering.
- **Tag boost:** Matching the requested `--tag` adds +0.10 to fuzzy confidence, biasing toward type-appropriate results.
- **Entity boost:** Tana entities (nodes with `_flags` LSB set) get +0.05, biasing toward "interesting" nodes over plain text.

## Tests

- **679 lines** of tests across 2 test files
- `tests/entity-resolution.test.ts` — Pure function unit tests: normalization, fuzzy confidence, semantic mapping, merge/dedup, action determination, name variants, FTS5 escaping, short query validation
- `tests/entity-match.test.ts` — Database integration tests: exact matching, fuzzy matching, tag filtering, full pipeline orchestration
