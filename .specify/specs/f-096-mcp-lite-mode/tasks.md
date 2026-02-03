# Implementation Tasks: F-096 MCP Lite Mode

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Extend tool mode types |
| T-1.2 | ☐ | Add lite tool mapping |
| T-2.1 | ☐ | Update config manager |
| T-2.2 | ☐ | Add --lite CLI flag |
| T-3.1 | ☐ | Update rejection messages |
| T-3.2 | ☐ | Update capabilities filtering |
| T-3.3 | ☐ | Update startup logging |
| T-4.1 | ☐ | Tool mode unit tests |
| T-4.2 | ☐ | Capabilities integration tests |
| T-4.3 | ☐ | Rejection message tests |
| T-5.1 | ☐ | Documentation updates |

---

## Group 1: Foundation

### T-1.1: Extend tool mode types and add LITE_MODE_TOOLS set [T]
- **File:** `src/mcp/tool-mode.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** none
- **Parallelizable:** [P with T-1.2]
- **Description:**
  Extend the tool mode system to support `'lite'` as a third mode:
  1. Change `ToolMode` type from `'full' | 'slim'` to `'full' | 'slim' | 'lite'`
  2. Add `LITE_MODE_TOOLS` set with exactly 16 tools:
     - Query (7): `tana_search`, `tana_semantic_search`, `tana_query`, `tana_aggregate`, `tana_timeline`, `tana_recent`, `tana_field_values`
     - Explore (3): `tana_batch_get`, `tana_related`, `tana_stats`
     - Transcript (3): `tana_transcript_list`, `tana_transcript_show`, `tana_transcript_search`
     - System (3): `tana_sync`, `tana_cache_clear`, `tana_capabilities`
  3. Update `isToolEnabled()` signature from `mode: 'full' | 'slim'` to `mode: 'full' | 'slim' | 'lite'` and add lite branch
  4. Update `getToolMode()` return type to `'full' | 'slim' | 'lite'`
  5. Add `getLiteModeToolCount(): number` helper
  6. Update `getExcludedTools()` signature to include `'lite'`
- **Acceptance:**
  - [ ] `LITE_MODE_TOOLS` has exactly 16 entries
  - [ ] `isToolEnabled('tana_search', 'lite')` returns `true`
  - [ ] `isToolEnabled('tana_create', 'lite')` returns `false`
  - [ ] `isToolEnabled('tana_search', 'full')` still returns `true` (no regression)
  - [ ] `getExcludedTools('lite', allToolNames)` returns 15-16 excluded tools
  - [ ] No mutation tools in `LITE_MODE_TOOLS` (zero overlap with CRUD operations)

### T-1.2: Add LITE_TOOL_MAPPING for tana-local equivalents [T]
- **File:** `src/mcp/tool-mode.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** none
- **Parallelizable:** [P with T-1.1]
- **Description:**
  Add a mapping record from excluded supertag tools to their tana-local equivalents:
  1. Add `LITE_TOOL_MAPPING: Record<string, string>` with all 16 excluded tools:
     - `tana_create` → `import_tana_paste`
     - `tana_batch_create` → `import_tana_paste`
     - `tana_update_node` → `edit_node`
     - `tana_tag_add` → `tag (action: add)`
     - `tana_tag_remove` → `tag (action: remove)`
     - `tana_create_tag` → `create_tag`
     - `tana_set_field` → `set_field_content`
     - `tana_set_field_option` → `set_field_option`
     - `tana_trash_node` → `trash_node`
     - `tana_done` → `check_node`
     - `tana_undone` → `uncheck_node`
     - `tana_node` → `read_node`
     - `tana_supertags` → `list_tags`
     - `tana_supertag_info` → `get_tag_schema`
     - `tana_tagged` → `search_nodes (hasType filter)`
     - `tana_tool_schema` → `tana_capabilities`
  2. Export the mapping for use in rejection messages
- **Acceptance:**
  - [ ] `LITE_TOOL_MAPPING` has entries for all excluded tools
  - [ ] Every key in `LITE_TOOL_MAPPING` is NOT in `LITE_MODE_TOOLS`
  - [ ] Union of `LITE_MODE_TOOLS` keys and `LITE_TOOL_MAPPING` keys covers all registered tools

---

## Group 2: Configuration

### T-2.1: Update ConfigManager for lite mode [T]
- **File:** `src/config/manager.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** T-1.1
- **Parallelizable:** [P with T-2.2]
- **Description:**
  Extend `ConfigManager` to recognize `'lite'` as a valid tool mode:
  1. Update `getMcpToolMode()` return type from `'full' | 'slim'` to `'full' | 'slim' | 'lite'` (line ~463)
  2. Add `'lite'` to the mode check: `if (mode === 'slim') return 'slim'; if (mode === 'lite') return 'lite'; return 'full';`
  3. Update `TANA_MCP_TOOL_MODE` env var parsing (line ~128) to accept `'lite'`: `if (mode === 'full' || mode === 'slim' || mode === 'lite')`
- **Acceptance:**
  - [ ] `getMcpToolMode()` returns `'lite'` when config has `mcp.toolMode: 'lite'`
  - [ ] `TANA_MCP_TOOL_MODE=lite` sets mode to `'lite'`
  - [ ] Invalid values still fall back to `'full'`
  - [ ] Existing `'full'` and `'slim'` behavior unchanged

### T-2.2: Add --lite CLI flag parsing [T]
- **File:** `src/mcp/index.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** T-1.1
- **Parallelizable:** [P with T-2.1]
- **Description:**
  Parse `--lite` from `process.argv` to set tool mode (highest priority override):
  1. Add flag parsing near top of `src/mcp/index.ts`, before server initialization:
     ```typescript
     if (process.argv.includes('--lite')) {
       process.env.TANA_MCP_TOOL_MODE = 'lite';
     } else if (process.argv.includes('--slim')) {
       process.env.TANA_MCP_TOOL_MODE = 'slim';
     }
     ```
  2. This follows the same pattern — env var is highest priority after CLI flags
  3. Also add `--slim` flag parsing for consistency (currently only configurable via env/config)
- **Acceptance:**
  - [ ] `supertag-mcp --lite` starts in lite mode with 16 tools
  - [ ] `supertag-mcp --slim` starts in slim mode with 14 tools
  - [ ] `supertag-mcp` (no flag) starts in full mode (unchanged)
  - [ ] CLI flag overrides env var and config file

---

## Group 3: Core Integration

### T-3.1: Update disabled-tool rejection messages [T]
- **File:** `src/mcp/index.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:**
  Update the tool rejection guard (line ~317-326) to include tana-local tool suggestions in lite mode:
  1. Import `LITE_TOOL_MAPPING` from `./tool-mode.js`
  2. Replace the current slim-only message with mode-aware logic:
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
  3. Existing slim mode behavior is preserved (no mapping lookup, same fallback message)
- **Acceptance:**
  - [ ] Calling `tana_create` in lite mode returns error mentioning `import_tana_paste`
  - [ ] Calling `tana_node` in lite mode returns error mentioning `read_node`
  - [ ] Calling `tana_search` in slim mode returns existing generic error (no regression)
  - [ ] Error includes suggestion to switch to full mode

### T-3.2: Update capabilities response to filter by mode [T]
- **File:** `src/mcp/tool-registry.ts`, `src/mcp/tools/capabilities.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Make `getCapabilities()` mode-aware so it only shows tools available in the current mode:
  1. Add `mode` field to `CapabilitiesResponse` interface in `tool-registry.ts` (line ~43)
  2. Update `getCapabilities()` signature to accept optional `mode` parameter (line ~322)
  3. Filter `TOOL_METADATA` by `isToolEnabled(t.name, mode)` before grouping by category
  4. Include `mode` in the response object
  5. Update `capabilities.ts` to pass current mode from `getToolMode()` to `getCapabilities()`
- **Acceptance:**
  - [ ] `getCapabilities()` in lite mode returns only 16 tools across categories
  - [ ] `getCapabilities()` in full mode returns all 32 tools (unchanged)
  - [ ] Response includes `mode: 'lite'` field
  - [ ] Category tool counts reflect filtered set (e.g., mutate category empty in lite mode)

### T-3.3: Update startup logging for lite mode [T]
- **File:** `src/mcp/index.ts`
- **Test:** `tests/mcp-lite-mode.test.ts`
- **Dependencies:** T-1.1
- **Parallelizable:** [P with T-3.1, T-3.2]
- **Description:**
  Update the `main()` startup log (line ~518-523) to handle lite mode tool count:
  1. Import `getLiteModeToolCount` from `./tool-mode.js`
  2. Update tool count logic: currently `mode === 'slim' ? getSlimModeToolCount() : allTools.length`
  3. Change to a mode switch: `mode === 'slim' ? getSlimModeToolCount() : mode === 'lite' ? getLiteModeToolCount() : allTools.length`
  4. Log should show: `supertag-mcp v2.x.x starting (mode: lite, tools: 16)`
- **Acceptance:**
  - [ ] Startup log shows `mode: lite, tools: 16` in lite mode
  - [ ] Startup log shows `mode: slim, tools: 14` in slim mode (unchanged)
  - [ ] Startup log shows `mode: full, tools: 32` in full mode (unchanged)

---

## Group 4: Tests

### T-4.1: Tool mode unit tests [T]
- **File:** `tests/mcp-lite-mode.test.ts`
- **Test:** (self)
- **Dependencies:** T-1.1, T-1.2
- **Parallelizable:** [P with T-4.2, T-4.3]
- **Description:**
  Create comprehensive unit tests for the lite mode tool set and mapping:
  1. `LITE_MODE_TOOLS` has exactly 16 entries
  2. `LITE_MODE_TOOLS` contains expected tools from each category (query, explore, transcript, system)
  3. `LITE_MODE_TOOLS` does NOT contain any mutation tools (verify zero overlap)
  4. `isToolEnabled()` for lite mode: included tools return `true`, excluded return `false`
  5. `isToolEnabled()` for full mode still returns `true` for all tools (regression check)
  6. `LITE_TOOL_MAPPING` covers all excluded tools (no excluded tool left without a mapping)
  7. `LITE_TOOL_MAPPING` keys and `LITE_MODE_TOOLS` are disjoint (no key appears in both)
  8. `getLiteModeToolCount()` returns 16
  9. `getExcludedTools('lite', allToolNames)` returns correct excluded count
- **Acceptance:**
  - [ ] All tool set membership tests pass
  - [ ] All mapping coverage tests pass
  - [ ] No regression on full/slim mode behavior

### T-4.2: Capabilities integration tests [T]
- **File:** `tests/mcp-lite-mode.test.ts`
- **Test:** (self)
- **Dependencies:** T-3.2
- **Parallelizable:** [P with T-4.1, T-4.3]
- **Description:**
  Test that capabilities response adapts to mode:
  1. `getCapabilities()` with mode `'lite'` returns only lite tools
  2. Response includes `mode: 'lite'` field
  3. Mutate category is empty or absent in lite mode
  4. Query category has 7 tools in lite mode
  5. System category has 3 tools in lite mode (no `tana_tool_schema`)
  6. Full mode capabilities unchanged (regression)
- **Acceptance:**
  - [ ] All capabilities mode-filtering tests pass
  - [ ] Category counts match spec

### T-4.3: Rejection message tests [T]
- **File:** `tests/mcp-lite-mode.test.ts`
- **Test:** (self)
- **Dependencies:** T-3.1
- **Parallelizable:** [P with T-4.1, T-4.2]
- **Description:**
  Test rejection messages contain tana-local equivalents:
  1. Calling excluded tool in lite mode returns `isError: true`
  2. Error text includes tool name and `'lite'` mode
  3. Error text includes tana-local equivalent from `LITE_TOOL_MAPPING`
  4. Error text includes suggestion to switch to full mode
  5. Slim mode rejection still uses generic message (no mapping lookup)
- **Acceptance:**
  - [ ] Rejection message for `tana_create` mentions `import_tana_paste`
  - [ ] Rejection message for `tana_node` mentions `read_node`
  - [ ] Slim mode rejection message unchanged

---

## Group 5: Documentation

### T-5.1: Update documentation for lite mode
- **File:** `SKILL.md`, `README.md`
- **Test:** none
- **Dependencies:** T-1.1 through T-3.3 (all implementation complete)
- **Description:**
  Update project documentation to describe lite mode:
  1. **SKILL.md**: Add lite mode description with `--lite` flag, explain two-layer architecture with tana-local
  2. **README.md**: Add lite mode to MCP setup section, show `claude_desktop_config.json` example with `--lite` flag
  3. Both docs should explain the three modes: full (standalone), slim (context-optimized), lite (complement tana-local)
- **Acceptance:**
  - [ ] SKILL.md documents `--lite` flag and lite mode purpose
  - [ ] README.md shows MCP config example with `--lite`
  - [ ] Three-mode comparison table in at least one doc

---

## Execution Order

```
T-1.1, T-1.2                    (foundation — no deps, parallel)
    ↓
T-2.1, T-2.2                    (config — parallel, depend on T-1.1)
    ↓
T-3.1, T-3.2, T-3.3             (integration — can run in parallel)
    ↓
T-4.1, T-4.2, T-4.3             (tests — parallel, test completed work)
    ↓
T-5.1                           (docs — after all implementation)
```

**Total tasks:** 11
**Parallelizable:** 8 (in groups of 2-3)
**Sequential gates:** Foundation → Config → Integration → Tests → Docs
