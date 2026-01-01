---
id: "061"
feature: "Progressive Disclosure"
status: "implemented"
created: "2026-01-01"
implemented: "2026-01-01"
---

# Specification: Progressive Disclosure (tana_capabilities)

## Overview

Implement a progressive disclosure pattern for MCP tools where Claude loads tool capabilities in stages. Instead of loading all 14+ tool schemas upfront (~2,000 tokens), Claude first loads a lightweight `tana_capabilities` tool that describes available operations, then loads full schemas only for tools it needs.

Based on Anthropic's MCP code execution patterns achieving 98.7% token savings.

## User Scenarios

### Scenario 1: AI Agent Initial Tool Discovery

**As an** AI agent starting a Tana-related task
**I want to** quickly understand what operations are available
**So that** I can decide which tools to load without consuming tokens on unused schemas

**Acceptance Criteria:**
- [ ] `tana_capabilities` returns lightweight list of available tools
- [ ] Each tool has name, category, and one-line description
- [ ] Response is < 500 tokens for all tools
- [ ] No detailed parameter schemas in initial response

### Scenario 2: AI Agent Loading Specific Tool

**As an** AI agent that needs to search
**I want to** load only the search tool's full schema
**So that** I save tokens by not loading create/sync/transcript schemas

**Acceptance Criteria:**
- [ ] `tana_capabilities` response includes how to request full schemas
- [ ] Agent can request schema for specific tool: `tana_tool_schema("tana_search")`
- [ ] Full schema includes all parameters, types, descriptions
- [ ] Unused tool schemas are never loaded

### Scenario 3: Capability Filtering

**As an** AI agent with a specific task type
**I want to** filter capabilities by category
**So that** I only see relevant tools for my task

**Acceptance Criteria:**
- [ ] Can filter by category: `tana_capabilities({ category: "query" })`
- [ ] Categories: `query`, `mutate`, `explore`, `transcript`, `system`
- [ ] Filtered response is even smaller than full capabilities list

## Functional Requirements

### FR-1: Capabilities Tool Response Structure

The `tana_capabilities` tool returns a lightweight inventory:

```typescript
{
  version: "0.7.0",
  categories: [
    {
      name: "query",
      description: "Find and search nodes",
      tools: [
        { name: "tana_search", description: "Full-text search" },
        { name: "tana_tagged", description: "Find by supertag" },
        { name: "tana_semantic_search", description: "Vector similarity" }
      ]
    },
    // ... other categories
  ],
  quickActions: ["search", "create", "show"]  // Common operations
}
```

**Validation:** Response is valid JSON under 500 tokens.

### FR-2: Schema Loading Tool

A `tana_tool_schema` tool returns full schema for a specific tool:

**Validation:**
- `tana_tool_schema("tana_search")` returns full JSON schema for search
- Invalid tool name returns error with list of valid tools
- Schema includes all parameters, types, defaults, descriptions

### FR-3: Category Definitions

Tools are grouped into logical categories:

| Category | Tools | Purpose |
|----------|-------|---------|
| `query` | search, tagged, semantic_search, field_values | Finding nodes |
| `explore` | supertags, stats, supertag_info, node | Exploring structure |
| `transcript` | transcript_list, transcript_show, transcript_search | Meeting transcripts |
| `mutate` | create, sync | Writing data |
| `system` | cache_clear, capabilities, tool_schema | Meta operations |

**Validation:** Every tool belongs to exactly one category.

### FR-4: Backwards Compatibility

Existing direct tool calls continue to work:

**Validation:**
- `tana_search` still works without calling `tana_capabilities` first
- No breaking changes to existing MCP integrations
- Progressive disclosure is opt-in optimization

## Non-Functional Requirements

- **Performance:** `tana_capabilities` responds in < 50ms
- **Token Efficiency:** Full capabilities < 500 tokens; individual schema < 300 tokens
- **Compatibility:** Works with Claude Desktop, Cursor, and other MCP clients

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| ToolCategory | Grouping of related tools | `name`, `description`, `tools[]` |
| ToolSummary | Lightweight tool info | `name`, `description` |
| ToolSchema | Full JSON schema for a tool | `parameters`, `returns`, `examples` |

## Success Criteria

- [ ] `tana_capabilities` response under 500 tokens
- [ ] Agent can complete common tasks loading only 1-2 tool schemas
- [ ] 50%+ reduction in upfront token cost for MCP initialization
- [ ] No regressions in existing tool functionality

## Assumptions

- MCP clients support calling one tool to decide which others to load
- Claude will actually use the progressive pattern when available
- Token savings justify the two-step process

## Clarifications (Resolved)

- **Example prompts:** Yes, include 1 brief example prompt per tool (~100 extra tokens total)
- **Schema caching:** Session cache - schemas cached within MCP server lifetime (cleared on restart)
- **Categories:** Fixed - hardcoded in implementation, not user-configurable

## Out of Scope

- Dynamic tool generation based on workspace schema
- Tool recommendation based on conversation context
- Automatic tool loading (always explicit)
- CLI equivalent (progressive disclosure is MCP-specific)
