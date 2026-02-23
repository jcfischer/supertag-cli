# Technical Plan: F-098 Context Assembler

## Architecture Overview

```
                              INPUT
                                │
                    ┌───────────┴───────────┐
                    │     topic OR nodeId   │
                    └───────────┬───────────┘
                                │
┌───────────────────────────────▼───────────────────────────────┐
│                      RESOLVE PHASE                            │
│  ┌─────────────────┐    ┌──────────────────────────────────┐ │
│  │  Search Query?  │───▶│  TanaReadBackend.search()        │ │
│  └─────────────────┘    │  (F-097 Live Read Backend)       │ │
│  ┌─────────────────┐    └──────────────────────────────────┘ │
│  │  Direct Node ID │───▶ Validate exists                     │
│  └─────────────────┘                                         │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      TRAVERSE PHASE                           │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  GraphTraversalService.traverse()  (F-065)               ││
│  │  - Walk parent/child/reference/field edges               ││
│  │  - Apply depth limit (default: 2, max: 5)                ││
│  │  - Apply lens-specific traversal patterns                ││
│  └──────────────────────────────────────────────────────────┘│
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      ENRICH PHASE                             │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Extract field values for collected nodes                ││
│  │  fieldQuery.getFieldValuesForNode() for each node        ││
│  └──────────────────────────────────────────────────────────┘│
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      SCORE PHASE                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  RelevanceScorer.score(nodes, query)                     ││
│  │  score = (1/distance)*0.4 + semantic*0.35 + recency*0.25 ││
│  │  Falls back to 60%/40% when embeddings unavailable       ││
│  └──────────────────────────────────────────────────────────┘│
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      BUDGET PHASE                             │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  TokenBudgeter.prune(scoredNodes, budget)                ││
│  │  - Sort by relevance score descending                    ││
│  │  - Include nodes until budget exhausted                  ││
│  │  - Summarize overflow nodes (name + type only)           ││
│  └──────────────────────────────────────────────────────────┘│
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      FORMAT PHASE                             │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  ContextFormatter.render(prunedNodes, format)            ││
│  │  - markdown: Hierarchical document with headers          ││
│  │  - json: Structured with metadata                        ││
│  └──────────────────────────────────────────────────────────┘│
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
                            OUTPUT
                     ContextDocument
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard, native SQLite, fast startup |
| Database | SQLite | Existing workspace databases, no new dependencies |
| CLI Framework | Commander.js | Project pattern, existing option helpers |
| Token Counting | tiktoken (via `js-tiktoken`) | Accurate GPT tokenization, lightweight |
| Validation | Zod | Project standard for schemas and options |
| Read Backend | F-097 TanaReadBackend | Abstracts Local API vs SQLite, already integrated |
| Graph Traversal | F-065 GraphTraversalService | Already implements depth/direction/type traversal |

## Data Model

```typescript
// =============================================================================
// Core Context Types
// =============================================================================

interface ContextDocument {
  /** Metadata about the context assembly */
  meta: ContextMeta;
  /** Ordered list of context nodes (highest relevance first) */
  nodes: ContextNode[];
  /** Summarized nodes that didn't fit in token budget */
  overflow: OverflowSummary[];
}

interface ContextMeta {
  /** Original query or node ID */
  query: string;
  /** Workspace alias */
  workspace: string;
  /** Lens used for traversal */
  lens: LensType;
  /** Token budget and usage */
  tokens: TokenUsage;
  /** Timestamp of assembly */
  assembledAt: string;
  /** Which read backend was used */
  backend: ReadBackendType;
}

interface ContextNode {
  /** Tana node ID */
  id: string;
  /** Node name/title */
  name: string;
  /** Node content (markdown) */
  content: string;
  /** Applied supertags */
  tags: string[];
  /** Field values (when --include-fields) */
  fields?: Record<string, string | string[]>;
  /** Relevance score (0-1) */
  score: number;
  /** Graph distance from source node */
  distance: number;
  /** Relationship path to source */
  path: RelationshipPath[];
}

interface OverflowSummary {
  id: string;
  name: string;
  tags: string[];
  score: number;
}

// =============================================================================
// Relevance Scoring
// =============================================================================

interface RelevanceScore {
  /** Combined relevance score (0-1) */
  total: number;
  /** Component scores for debugging/tuning */
  components: {
    graphDistance: number;    // (1 / distance) * 0.4
    semanticSim?: number;     // embedding similarity * 0.35 (optional)
    recency: number;          // recency boost * 0.25
  };
}

interface ScoringOptions {
  /** Source node ID for distance calculation */
  sourceNodeId: string;
  /** Query text for semantic similarity (if embeddings available) */
  queryText?: string;
  /** Whether embeddings are available */
  embeddingsAvailable: boolean;
}

// =============================================================================
// Token Budgeting
// =============================================================================

interface TokenBudget {
  /** Total token budget (default: 4000) */
  maxTokens: number;
  /** Reserved for metadata header (default: 200) */
  headerReserve: number;
  /** Minimum tokens per node to include (default: 50) */
  minPerNode: number;
}

interface TokenUsage {
  /** Budget that was set */
  budget: number;
  /** Actual tokens used */
  used: number;
  /** Percentage of budget used */
  utilization: number;
  /** Number of nodes that fit */
  nodesIncluded: number;
  /** Number of nodes summarized */
  nodesSummarized: number;
}

// =============================================================================
// Graph Lenses
// =============================================================================

type LensType = 'general' | 'writing' | 'coding' | 'planning' | 'meeting-prep';

interface LensConfig {
  /** Lens identifier */
  name: LensType;
  /** Relationship types to prioritize */
  priorityTypes: RelationshipType[];
  /** Tags to boost in relevance scoring */
  boostTags?: string[];
  /** Field names to always include */
  includeFields?: string[];
  /** Maximum traversal depth for this lens */
  maxDepth: number;
}

const LENS_CONFIGS: Record<LensType, LensConfig> = {
  general: {
    name: 'general',
    priorityTypes: ['child', 'parent', 'reference', 'field'],
    maxDepth: 3,
  },
  writing: {
    name: 'writing',
    priorityTypes: ['child', 'reference'],
    boostTags: ['note', 'draft', 'writing', 'article'],
    maxDepth: 2,
  },
  coding: {
    name: 'coding',
    priorityTypes: ['reference', 'field'],
    boostTags: ['spec', 'architecture', 'code', 'decision'],
    includeFields: ['status', 'priority', 'assignee'],
    maxDepth: 3,
  },
  planning: {
    name: 'planning',
    priorityTypes: ['child', 'field'],
    boostTags: ['goal', 'milestone', 'task', 'project'],
    includeFields: ['due', 'status', 'blocked-by'],
    maxDepth: 4,
  },
  'meeting-prep': {
    name: 'meeting-prep',
    priorityTypes: ['reference', 'child'],
    boostTags: ['person', 'meeting', 'action', 'agenda'],
    includeFields: ['attendees', 'date', 'status'],
    maxDepth: 2,
  },
};

// =============================================================================
// CLI Options Schema
// =============================================================================

const ContextOptionsSchema = z.object({
  workspace: z.string().optional(),
  depth: z.number().min(1).max(5).default(2),
  maxTokens: z.number().min(500).default(4000),
  includeFields: z.boolean().default(true),
  lens: z.enum(['general', 'writing', 'coding', 'planning', 'meeting-prep']).default('general'),
  format: z.enum(['markdown', 'json']).default('markdown'),
});
```

## API Contracts

### CLI Command

```bash
# Basic usage with search query
supertag context "SOC Defender project"

# With node ID directly
supertag context abc123def456 --depth 3

# With token budget and lens
supertag context "quarterly planning" --max-tokens 8000 --lens planning

# JSON output for programmatic use
supertag context abc123 --format json

# Without field values
supertag context "meeting notes" --no-include-fields
```

### MCP Tool

```typescript
// Tool: tana_context
{
  name: "tana_context",
  description: "Assemble structured context from the Tana knowledge graph for a topic or node",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Topic to search for or node ID to start from"
      },
      depth: {
        type: "number",
        description: "Traversal depth (1-5, default: 2)",
        default: 2
      },
      maxTokens: {
        type: "number",
        description: "Token budget for output (default: 4000)",
        default: 4000
      },
      lens: {
        type: "string",
        enum: ["general", "writing", "coding", "planning", "meeting-prep"],
        description: "Traversal pattern to use",
        default: "general"
      },
      includeFields: {
        type: "boolean",
        description: "Include field values in context",
        default: true
      },
      format: {
        type: "string",
        enum: ["markdown", "json"],
        description: "Output format",
        default: "markdown"
      },
      workspace: {
        type: "string",
        description: "Workspace alias (default: main)"
      }
    },
    required: ["query"]
  }
}
```

### Response Format (JSON)

```json
{
  "meta": {
    "query": "SOC Defender project",
    "workspace": "main",
    "lens": "coding",
    "tokens": {
      "budget": 4000,
      "used": 3842,
      "utilization": 0.96,
      "nodesIncluded": 12,
      "nodesSummarized": 5
    },
    "assembledAt": "2026-02-22T18:30:00Z",
    "backend": "local-api"
  },
  "nodes": [
    {
      "id": "abc123",
      "name": "SOC Defender",
      "content": "# SOC Defender\n\nSecurity operations dashboard...",
      "tags": ["project", "security"],
      "fields": {
        "status": "active",
        "owner": "Jens-Christian"
      },
      "score": 1.0,
      "distance": 0,
      "path": []
    }
  ],
  "overflow": [
    {
      "id": "xyz789",
      "name": "Related security tool",
      "tags": ["tool"],
      "score": 0.23
    }
  ]
}
```

## Implementation Phases

### Phase 1: Core Data Layer (T-1.x)

1. **T-1.1**: Create `src/types/context.ts` with all type definitions above
2. **T-1.2**: Create `src/services/token-counter.ts` using js-tiktoken
3. **T-1.3**: Create `src/services/relevance-scorer.ts` with scoring formula
4. **T-1.4**: Create `src/services/token-budgeter.ts` for pruning logic

### Phase 2: Context Assembly Service (T-2.x)

1. **T-2.1**: Create `src/services/context-assembler.ts` orchestrating the pipeline
2. **T-2.2**: Integrate with F-097 `resolveReadBackend()` for resolve phase
3. **T-2.3**: Integrate with F-065 `GraphTraversalService` for traverse phase
4. **T-2.4**: Create `src/services/context-formatter.ts` for markdown/json output
5. **T-2.5**: Implement lens configurations with traversal pattern customization

### Phase 3: CLI Integration (T-3.x)

1. **T-3.1**: Create `src/commands/context.ts` with Commander.js
2. **T-3.2**: Add standard workspace/format options via existing helpers
3. **T-3.3**: Register command in main CLI entry point
4. **T-3.4**: Add tests for CLI argument parsing and output formats

### Phase 4: MCP Tool Integration (T-4.x)

1. **T-4.1**: Create `src/mcp/tools/context.ts` tool handler
2. **T-4.2**: Add schema to `src/mcp/schemas.ts`
3. **T-4.3**: Register in `src/mcp/tool-registry.ts` and `tool-mode.ts`
4. **T-4.4**: Add dispatch case in `src/mcp/index.ts`

### Phase 5: Testing & Documentation (T-5.x)

1. **T-5.1**: Unit tests for token counter (accuracy within 10%)
2. **T-5.2**: Unit tests for relevance scorer (formula correctness)
3. **T-5.3**: Integration tests for context assembly pipeline
4. **T-5.4**: E2E tests for CLI command
5. **T-5.5**: Update README with context command documentation
6. **T-5.6**: Update SKILL.md with MCP tool documentation

## File Structure

```
src/
├── types/
│   └── context.ts                 # ContextDocument, RelevanceScore, TokenBudget, LensConfig
├── services/
│   ├── context-assembler.ts       # Main orchestration service
│   ├── token-counter.ts           # tiktoken wrapper
│   ├── relevance-scorer.ts        # Scoring formula implementation
│   ├── token-budgeter.ts          # Budget enforcement and pruning
│   └── context-formatter.ts       # Markdown/JSON output formatting
├── commands/
│   └── context.ts                 # CLI command handler
└── mcp/
    └── tools/
        └── context.ts             # MCP tool handler

tests/
├── services/
│   ├── token-counter.test.ts
│   ├── relevance-scorer.test.ts
│   ├── token-budgeter.test.ts
│   └── context-assembler.test.ts
├── commands/
│   └── context.test.ts
└── mcp/
    └── context-tool.test.ts
```

## Dependencies

### External Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `js-tiktoken` | ^1.0.12 | Token counting (GPT-compatible) |

### Internal Dependencies (Already Exist)

| Module | Path | Purpose |
|--------|------|---------|
| F-097 Read Backend | `src/api/read-backend-resolver.ts` | `resolveReadBackend()` for search/read operations |
| F-097 Types | `src/api/read-backend.ts` | `ReadSearchResult`, `ReadNodeContent`, `TanaReadBackend` |
| F-065 Graph Traversal | `src/services/graph-traversal.ts` | `GraphTraversalService.traverse()` |
| F-065 Types | `src/types/graph.ts` | `RelatedQuery`, `RelatedResult`, `RelatedNode`, `RelationshipType` |
| Field Queries | `src/db/field-query.ts` | `getFieldValuesForNode()` for field extraction |
| Semantic Search | `src/embeddings/` | Optional embedding similarity (if generated) |
| Workspace Resolver | `src/config/workspace-resolver.ts` | `resolveWorkspaceContext()` |
| Structured Errors | `src/utils/structured-errors.ts` | `StructuredError` for error handling |

### Integration Points

```typescript
// F-097 Integration (Resolve Phase)
import { resolveReadBackend } from '../api/read-backend-resolver';
const backend = await resolveReadBackend({ workspace });
const searchResults = await backend.search(query, { limit: 10 });

// F-065 Integration (Traverse Phase)
import { GraphTraversalService } from '../services/graph-traversal';
const traverser = new GraphTraversalService(ws.dbPath);
const related = await traverser.traverse({
  nodeId: sourceId,
  direction: 'both',
  types: lensConfig.priorityTypes,
  depth: options.depth,
  limit: 100,
}, ws.alias);

// Semantic Similarity (Optional)
import { SemanticSearch } from '../embeddings/semantic-search';
const semanticSearch = new SemanticSearch(ws.dbPath);
const hasEmbeddings = await semanticSearch.hasEmbeddings();
```

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Token count inaccuracy > 10% | Medium | Low | Use tiktoken (same as OpenAI); add calibration tests against known token counts |
| Performance > 3s for depth 2 | High | Medium | Cache traversal results; limit field extraction to top-N nodes; profile and optimize hot paths |
| Embeddings unavailable | Low | High | Already designed: fall back to distance + recency scoring; document in output metadata |
| Large node (500+ children) blows budget | Medium | Medium | Sample top-N children by relevance before adding to context; note truncation in metadata |
| Circular references cause infinite loop | High | Low | GraphTraversalService already tracks visited nodes; verify in integration tests |
| Local API unavailable | Low | Medium | F-097 read backend resolver falls back to SQLite automatically; context may be stale but functional |
| User requests depth > 5 | Low | Low | Zod schema enforces max depth of 5; CLI shows validation error |
| Token budget < 500 | Low | Low | Return summary-only context; warn user in output metadata |

## Open Questions

1. **Lens customization (v2)**: Should custom lenses be defined in workspace config or a separate `.supertag/lenses.json` file?
2. **Context caching (v2)**: Would caching assembled contexts with TTL improve performance for repeated queries?
3. **Multi-query blending (v2)**: How should "combine project X and person Y" work? Weighted union? Sequential assembly?

---
*Plan created: 2026-02-22*
*Spec: F-098-context-assembler*
*Dependencies: F-097, F-065*
