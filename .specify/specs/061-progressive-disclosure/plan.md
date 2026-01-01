---
feature: "Progressive Disclosure"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Progressive Disclosure (tana_capabilities)

## Architecture Overview

Implement a two-tier MCP tool discovery pattern where Claude first loads a lightweight `tana_capabilities` tool, then loads full schemas on-demand via `tana_tool_schema`. This reduces upfront token cost from ~2,000 to ~400 tokens.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MCP CLIENT (Claude)                          │
│                                                                     │
│  1. ListTools() → [tana_capabilities, tana_tool_schema, ...]       │
│                        ↓                                            │
│  2. tana_capabilities() → lightweight inventory (~400 tokens)       │
│                        ↓                                            │
│  3. tana_tool_schema("tana_search") → full schema (~150 tokens)    │
│                        ↓                                            │
│  4. tana_search({...}) → execute with full knowledge               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        MCP SERVER (supertag)                        │
│                                                                     │
│  src/mcp/                                                           │
│  ├── tool-registry.ts  ← NEW: Tool metadata, categories, examples  │
│  ├── tools/                                                         │
│  │   ├── capabilities.ts  ← NEW: tana_capabilities handler         │
│  │   └── tool-schema.ts   ← NEW: tana_tool_schema handler          │
│  └── index.ts          ← MODIFIED: Register new tools              │
└─────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard, fast startup |
| Schema | Zod | Already used for all MCP tools |
| Caching | In-memory Map | Simple session cache for schemas |
| JSON Schema | zodToJsonSchema | Existing utility in schemas.ts |

## Constitutional Compliance

- [x] **CLI-First:** Not applicable (MCP-specific optimization)
- [x] **Library-First:** Tool registry is a reusable module independent of MCP
- [x] **Test-First:** TDD for registry, capabilities, and schema tools
- [x] **Deterministic:** Fixed categories, no probabilistic behavior
- [x] **Code Before Prompts:** All logic in TypeScript, examples are static data

## Data Model

### Entities

```typescript
// Tool category grouping
interface ToolCategory {
  name: 'query' | 'explore' | 'transcript' | 'mutate' | 'system';
  description: string;
  tools: ToolSummary[];
}

// Lightweight tool info for capabilities response
interface ToolSummary {
  name: string;           // e.g., "tana_search"
  description: string;    // One-line description
  example?: string;       // Brief example prompt (user preference)
}

// Capabilities response structure
interface CapabilitiesResponse {
  version: string;        // MCP server version
  categories: ToolCategory[];
  quickActions: string[]; // Common operations for quick reference
}

// Schema cache for session persistence (user preference)
interface SchemaCache {
  schemas: Map<string, object>;  // tool name → JSON schema
  hits: number;
  misses: number;
}
```

### Category Assignment (Fixed per user preference)

| Category | Tools |
|----------|-------|
| `query` | tana_search, tana_tagged, tana_semantic_search, tana_field_values |
| `explore` | tana_supertags, tana_stats, tana_supertag_info, tana_node |
| `transcript` | tana_transcript_list, tana_transcript_show, tana_transcript_search |
| `mutate` | tana_create, tana_sync |
| `system` | tana_cache_clear, tana_capabilities, tana_tool_schema |

## API Contracts

### Internal APIs

```typescript
// Tool Registry Module
interface ToolRegistry {
  // Get lightweight capabilities inventory
  getCapabilities(filter?: { category?: string }): CapabilitiesResponse;

  // Get full JSON schema for a tool
  getToolSchema(toolName: string): object | null;

  // Validate tool exists
  hasTools(toolName: string): boolean;

  // List all tool names
  listToolNames(): string[];
}

// Factory function
function createToolRegistry(): ToolRegistry;
```

### MCP Tool Schemas

```typescript
// tana_capabilities input
const capabilitiesSchema = z.object({
  category: z.enum(['query', 'explore', 'transcript', 'mutate', 'system'])
    .optional()
    .describe('Filter to specific category'),
});

// tana_tool_schema input
const toolSchemaSchema = z.object({
  tool: z.string()
    .min(1)
    .describe('Tool name (e.g., "tana_search")'),
});
```

## Implementation Strategy

### Phase 1: Foundation (Tool Registry)

Build the core registry module that centralizes tool metadata.

- [ ] Create `src/mcp/tool-registry.ts` with ToolRegistry interface
- [ ] Define tool metadata (name, description, category, example)
- [ ] Implement `getCapabilities()` with optional category filter
- [ ] Implement `getToolSchema()` with session caching
- [ ] Tests: 15-20 unit tests for registry functions

### Phase 2: MCP Tools

Implement the two new MCP tools.

- [ ] Create `src/mcp/tools/capabilities.ts` - tana_capabilities handler
- [ ] Create `src/mcp/tools/tool-schema.ts` - tana_tool_schema handler
- [ ] Add schemas to `src/mcp/schemas.ts`
- [ ] Tests: Integration tests for MCP tool responses

### Phase 3: Integration

Wire into MCP server and update existing infrastructure.

- [ ] Register tools in `src/mcp/index.ts`
- [ ] Refactor existing tool definitions to use registry
- [ ] Update README with progressive disclosure documentation
- [ ] Tests: E2E tests verifying token reduction

## File Structure

```
src/mcp/
├── tool-registry.ts           # [New] Central tool metadata registry
├── tool-registry.test.ts      # [New] Registry unit tests
├── tools/
│   ├── capabilities.ts        # [New] tana_capabilities handler
│   ├── capabilities.test.ts   # [New] Capabilities tests
│   ├── tool-schema.ts         # [New] tana_tool_schema handler
│   ├── tool-schema.test.ts    # [New] Schema tool tests
│   └── __tests__/
│       └── progressive.test.ts # [New] Integration tests
├── schemas.ts                 # [Modified] Add capability schemas
└── index.ts                   # [Modified] Register new tools

tests/
└── progressive-disclosure.test.ts  # [New] E2E tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MCP clients ignore capabilities tool | Medium | Medium | Document pattern, test with Claude Desktop |
| Token counting inaccurate | Low | Low | Use tiktoken for validation |
| Schema caching stale data | Low | Low | Clear on server restart, no persistence |
| Category assignment disagreements | Low | Low | Fixed categories per spec |

## Dependencies

### External

- `@modelcontextprotocol/sdk` - Already installed, MCP server framework
- `zod` - Already installed, schema validation

### Internal

- `src/mcp/schemas.ts` - Existing Zod→JSON Schema conversion
- `src/version.ts` - Version string for capabilities response
- `src/utils/structured-errors.ts` - Error handling

## Migration/Deployment

- [ ] **Database migrations needed?** No
- [ ] **Environment variables?** No
- [ ] **Breaking changes?** No - progressive disclosure is opt-in

Backwards compatibility is guaranteed:
- Existing direct tool calls continue to work unchanged
- `tana_capabilities` and `tana_tool_schema` are additive
- MCP clients that don't use progressive disclosure see no difference

## Estimated Complexity

- **New files:** ~6 (registry, 2 tools, 3 test files)
- **Modified files:** ~3 (schemas.ts, index.ts, README)
- **Test files:** ~4
- **Estimated tasks:** ~12-15

## Token Budget Validation

Target: < 500 tokens for capabilities response

```
Estimated response size:
- Header (version, intro): ~30 tokens
- 5 categories × ~15 tokens each: ~75 tokens
- 14 tools × ~20 tokens (name + description + example): ~280 tokens
- Quick actions: ~15 tokens
Total: ~400 tokens ✓
```

Individual schema target: < 300 tokens
- Largest schema (tana_create): ~250 tokens ✓

## Schema Caching Strategy (per user preference)

Session-level caching within MCP server lifetime:

```typescript
// In tool-registry.ts
const schemaCache = new Map<string, object>();

function getToolSchema(toolName: string): object | null {
  if (schemaCache.has(toolName)) {
    return schemaCache.get(toolName)!;
  }

  const schema = buildSchema(toolName);
  if (schema) {
    schemaCache.set(toolName, schema);
  }
  return schema;
}
```

Cache is automatically cleared when:
- MCP server restarts
- Claude Code session ends
- Explicit cache clear (not implemented - not needed)
