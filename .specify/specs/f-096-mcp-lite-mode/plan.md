# Implementation Plan: MCP Lite Mode

**Feature ID:** F-096
**Complexity:** Low-Medium (~2-3 hours)
**Risk:** Low (additive change, existing pattern)

---

## Architecture

Extends the existing `tool-mode.ts` pattern from F-095. The current system supports `'full' | 'slim'` modes via a tool whitelist set. Lite mode adds a third mode with its own whitelist and tana-local-aware rejection messages.

### Mode Comparison

| Aspect | Full (32 tools) | Slim (14 tools) | Lite (16 tools) |
|--------|-----------------|-----------------|-----------------|
| **Purpose** | Standalone Tana access | Context-optimized standalone | Complement tana-local |
| **CRUD** | Yes (Input API + Local API) | Yes (mutations only) | No (delegated to tana-local) |
| **Analytics** | Yes | No | Yes |
| **Search** | FTS + semantic + tagged | Semantic only | FTS + semantic + query |
| **Transcripts** | Yes | No | Yes |
| **Offline** | Yes | Partial | Yes |
| **Use with tana-local** | Overlap exists | Not designed for it | Zero overlap |

---

## Implementation Tasks

### T-1: Extend Tool Mode Types

**File:** `src/mcp/tool-mode.ts`

1. Change type from `'full' | 'slim'` to `'full' | 'slim' | 'lite'`
2. Add `LITE_MODE_TOOLS` set with the 16 included tools
3. Update `isToolEnabled()` to handle `'lite'` mode
4. Add `getLiteModeToolCount()` helper
5. Add `LITE_TOOL_MAPPING` record mapping excluded tools to their tana-local equivalents

```typescript
export const LITE_MODE_TOOLS: Set<string> = new Set([
  // Query (7)
  'tana_search',
  'tana_semantic_search',
  'tana_query',
  'tana_aggregate',
  'tana_timeline',
  'tana_recent',
  'tana_field_values',

  // Explore (3)
  'tana_batch_get',
  'tana_related',
  'tana_stats',

  // Transcript (3)
  'tana_transcript_list',
  'tana_transcript_show',
  'tana_transcript_search',

  // System (3)
  'tana_sync',
  'tana_cache_clear',
  'tana_capabilities',
]);

/** Maps excluded lite tools to their tana-local equivalents */
export const LITE_TOOL_MAPPING: Record<string, string> = {
  tana_create: 'import_tana_paste',
  tana_batch_create: 'import_tana_paste',
  tana_update_node: 'edit_node',
  tana_tag_add: 'tag (action: add)',
  tana_tag_remove: 'tag (action: remove)',
  tana_create_tag: 'create_tag',
  tana_set_field: 'set_field_content',
  tana_set_field_option: 'set_field_option',
  tana_trash_node: 'trash_node',
  tana_done: 'check_node',
  tana_undone: 'uncheck_node',
  tana_node: 'read_node',
  tana_supertags: 'list_tags',
  tana_supertag_info: 'get_tag_schema',
  tana_tagged: 'search_nodes (hasType filter)',
  tana_tool_schema: 'tana_capabilities',
};
```

### T-2: Update Config Manager

**File:** `src/config/manager.ts`

1. Update `getMcpToolMode()` return type to `'full' | 'slim' | 'lite'`
2. Update environment variable parsing for `TANA_MCP_TOOL_MODE` to accept `'lite'`
3. Update config schema to allow `'lite'` in `mcp.toolMode`

### T-3: Add --lite CLI Flag

**File:** `src/mcp/index.ts`

1. Parse `--lite` from `process.argv` (same pattern as if `--slim` were added)
2. Set mode before server initialization
3. Alternatively: let the config/env mechanism handle it (simpler)

Recommended approach: parse `process.argv` for `--lite` and `--slim` flags, override config:

```typescript
// CLI flag parsing (highest priority)
if (process.argv.includes('--lite')) {
  process.env.SUPERTAG_MCP_MODE = 'lite';
} else if (process.argv.includes('--slim')) {
  process.env.SUPERTAG_MCP_MODE = 'slim';
}
```

### T-4: Update Rejection Messages

**File:** `src/mcp/index.ts`

Update the disabled-tool guard to include tana-local tool suggestions in lite mode:

```typescript
if (!isToolEnabled(name, mode)) {
  const mapping = LITE_TOOL_MAPPING[name];
  const suggestion = mode === 'lite' && mapping
    ? ` Use tana-local's '${mapping}' instead.`
    : '';
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: `Tool '${name}' is not available in ${mode} mode.${suggestion} Switch to full mode for standalone access.`,
    }],
  };
}
```

### T-5: Update Capabilities Response

**File:** `src/mcp/tool-registry.ts` and `src/mcp/tools/capabilities.ts`

1. Add `mode` field to `CapabilitiesResponse`
2. Filter `TOOL_METADATA` based on current mode in `getCapabilities()`
3. Update category tool counts to reflect filtered set

### T-6: Update Startup Logging

**File:** `src/mcp/index.ts`

Already logs mode and tool count. Just ensure `'lite'` mode reports correctly:

```
supertag-mcp v2.x.x starting (mode: lite, tools: 16)
```

### T-7: Tests

**New file:** `tests/mcp-lite-mode.test.ts`

1. Test `LITE_MODE_TOOLS` has exactly 16 entries
2. Test `isToolEnabled()` for lite mode: included tools return true, excluded return false
3. Test `LITE_TOOL_MAPPING` covers all excluded tools
4. Test rejection message includes tana-local equivalent
5. Test capabilities response in lite mode only shows lite tools
6. Test `--lite` flag sets mode correctly
7. Test no overlap: `LITE_MODE_TOOLS` intersection with mutation tool names is empty

### T-8: Documentation

1. Update `SKILL.md` — add lite mode description and `--lite` flag
2. Update `README.md` — add lite mode to MCP setup section
3. No course changes needed (c-002 already teaches `--lite`)

---

## File Change Summary

| File | Change |
|------|--------|
| `src/mcp/tool-mode.ts` | Add `LITE_MODE_TOOLS`, `LITE_TOOL_MAPPING`, update types |
| `src/config/manager.ts` | Extend mode type to include `'lite'` |
| `src/mcp/index.ts` | Parse `--lite` flag, update rejection messages |
| `src/mcp/tool-registry.ts` | Add mode to capabilities response, filter by mode |
| `src/mcp/tools/capabilities.ts` | Pass mode to getCapabilities |
| `tests/mcp-lite-mode.test.ts` | New test file |
| `SKILL.md` | Document lite mode |
| `README.md` | Document lite mode setup |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI agents confused by mode name | Low | Low | Clear error messages with tana-local tool names |
| Slim vs Lite confusion | Medium | Low | Document distinct purposes (standalone vs complement) |
| Missing tool in lite set | Low | Medium | Test that lite set matches spec exactly |
| tana-local API changes | Low | None | Lite mode is additive; doesn't depend on tana-local |

---

## Verification

- [ ] `supertag-mcp --lite` starts with 16 tools
- [ ] `supertag-mcp` (no flag) starts with 32 tools (unchanged)
- [ ] `supertag-mcp --slim` starts with 14 tools (unchanged)
- [ ] Calling `tana_create` in lite mode returns error with `import_tana_paste` suggestion
- [ ] `tana_capabilities` in lite mode shows only lite tools
- [ ] All 16 lite tools are callable and return results
- [ ] `bun run test` passes (no regressions)
- [ ] `bun run typecheck` passes
