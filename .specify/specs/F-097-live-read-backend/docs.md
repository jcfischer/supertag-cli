# Documentation Updates: F-097 Live Read Backend

## Files Updated

### CLAUDE.md
- Added "Live Read Backend (F-097)" section documenting:
  - `TanaReadBackend` interface and canonical types
  - `resolveReadBackend()` resolution flow
  - `resolveReadBackendFromOptions()` CLI helper
  - What routes through the read backend vs stays on SQLite
  - `--offline` flag documentation

### README.md
- Updated architecture section mentioning live read backend
- Documented `--offline` flag in CLI options

### CHANGELOG.md
- Added F-097 entry under appropriate release version

## Key Documentation Points

### For CLI Users
- Read/search operations now prefer Tana's Local API when available
- SQLite fallback is automatic and transparent
- `--offline` flag forces SQLite regardless of Local API availability
- Semantic search (`--semantic`) always uses SQLite (embeddings are local-only)

### For MCP Consumers
- `tana_search` and `tana_node` tools now return live data when Tana Desktop is running
- No changes to tool schemas or response formats
- Results are identical in structure regardless of backend

### For Developers
- `resolveReadBackend()` never throws — always returns a usable backend
- Backend is session-cached (one health check per session)
- `clearWorkspaceCache()` / `clearReadBackendCache()` for testing
- Both backends normalize to canonical `ReadSearchResult` and `ReadNodeContent` types
