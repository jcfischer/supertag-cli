# Specification: F-098 Context Assembler

## Context
> Replaces draft spec 071-context-building with a more comprehensive scope informed by the Tana Graph DB analysis.
> Builds on F-097 (Live Read Backend) for data access and F-065 (Graph Traversal) for relationship walking.

## Problem Statement

**Core Problem**: AI agents (Claude Code, MCP consumers) need structured, relevant context from the Tana knowledge graph before performing tasks — but assembling that context today requires manual multi-step queries (search → read → traverse → extract fields). There's no single operation that says "give me everything relevant about X, formatted for an AI context window."

**Current State**:
- `supertag search` finds nodes by text/tag
- `supertag related` traverses graph connections
- `supertag nodes show` reads individual nodes
- `supertag fields values` extracts field data
- No orchestration layer chains these into a coherent context bundle
- No token budgeting — users must manually manage context window limits

**Impact if Unsolved**: Every AI workflow that needs Tana context requires bespoke prompt engineering to chain multiple CLI/MCP calls. Context quality varies wildly. Token budgets are exceeded or underutilized.

## Users & Stakeholders

**Primary User**: AI agents (Claude Code, MCP consumers) that need grounded context from Tana
- Expects: one command/tool call → structured context document
- Needs: relevance-ranked, token-budgeted, format-flexible output

**Secondary**:
- CLI users who want a quick "brief me on topic X" command
- pai-seed integration (F-105) — uses context assembler for graph-aware memory retrieval

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | `supertag context <topic-or-id>` command that assembles a context document | Must |
| FR-2 | Accept either a node ID or a search query as the starting point | Must |
| FR-3 | Walk outward from the starting node(s) using graph traversal (parent, children, references, field links) | Must |
| FR-4 | `--depth <n>` controls traversal depth (default: 2, max: 5) | Must |
| FR-5 | `--max-tokens <n>` sets a token budget for the output (default: 4000) | Must |
| FR-6 | Relevance scoring: rank related nodes by graph distance + semantic similarity + recency | Should |
| FR-7 | Prune output based on relevance when token budget is exceeded | Must |
| FR-8 | `--include-fields` flag to include field values in the context (default: true) | Should |
| FR-9 | `--format markdown` (default) and `--format json` output modes | Must |
| FR-10 | MCP tool `tana_context` with same capabilities | Must |
| FR-11 | Graph Lenses: predefined traversal patterns for common task types | Should |
| FR-12 | `--lens <name>` flag to select a predefined lens (e.g., `writing`, `coding`, `planning`, `meeting-prep`) | Should |
| FR-13 | Context metadata: include source node IDs, traversal path, relevance scores | Should |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Context assembly completes in < 3 seconds for depth ≤ 2 |
| NFR-2 | Token counting uses tiktoken or equivalent for accurate budget enforcement |
| NFR-3 | Works with both Local API and SQLite backends (via F-097 read backend) |
| NFR-4 | Output is immediately usable as AI prompt context without further processing |

## Architecture

### Context Assembly Pipeline

```
Input (topic/ID)
  → Resolve: find starting node(s) via search or direct ID lookup
  → Traverse: walk graph outward to --depth, collecting nodes
  → Enrich: extract field values for collected nodes
  → Score: rank by relevance (graph distance, semantic sim, recency)
  → Budget: prune lowest-relevance nodes until within --max-tokens
  → Format: render as markdown or JSON with metadata
```

### Graph Lenses (Predefined Traversal Patterns)

| Lens | Traversal Strategy | Prioritizes |
|------|-------------------|-------------|
| `general` | Balanced: children, references, fields equally | Breadth |
| `writing` | Content + style notes + related writings | Textual content |
| `coding` | Specs, architecture decisions, related code refs | Technical detail |
| `planning` | Goals, constraints, timelines, dependencies | Structure |
| `meeting-prep` | Attendees, agenda, related projects, action items | People + actions |

### Token Budgeting

```typescript
interface TokenBudget {
  maxTokens: number;         // Total budget
  headerReserve: number;     // Reserved for metadata header (default: 200)
  perNodeEstimate: number;   // Estimated tokens per node for pruning decisions
}
```

Nodes are added to the context in relevance order until the budget is exhausted. A node that would exceed the budget is summarized (name + type only) rather than fully included.

### Relevance Scoring

```
score = (1 / graphDistance) * 0.4    // Closer = more relevant
      + semanticSimilarity * 0.35   // Embedding similarity to query
      + recencyBoost * 0.25         // Recently modified = more relevant
```

If embeddings are not available (no `embed generate` run), semantic similarity is skipped and weights redistribute to 60% distance + 40% recency.

## Scope

### In Scope
- `supertag context` CLI command
- `tana_context` MCP tool
- Token-budgeted context assembly
- Relevance scoring with graph distance + optional semantic similarity
- Predefined graph lenses
- Markdown and JSON output formats

### Explicitly Out of Scope
- Interactive context refinement ("show me more about X")
- Context caching across sessions
- Real-time context streaming (WebSocket)
- Custom lens creation by users (predefined only in v1)

### Designed For But Not Implemented
- Custom lens definitions via config file
- Context diff ("what changed since last assembly")
- Multi-topic context blending ("combine project X and person Y contexts")

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Topic not found in graph | Return empty context with "no matching nodes found" message |
| Token budget too small (< 500) | Warn and return summary-only context (names + types, no content) |
| Circular references in graph | Track visited nodes; skip already-visited |
| Node with 500+ children | Sample top-N by relevance, note truncation in metadata |
| Embeddings not generated | Fall back to distance + recency scoring; note in metadata |
| Offline mode (no Local API) | Use SQLite backend; context may be stale but still functional |

## Success Criteria

- [ ] `supertag context "SOC Defender"` returns a structured context document
- [ ] `supertag context <node-id> --depth 3 --max-tokens 8000` respects both parameters
- [ ] Token count of output does not exceed --max-tokens by more than 10%
- [ ] `supertag context "meeting" --lens meeting-prep` uses the meeting-prep traversal pattern
- [ ] `tana_context` MCP tool returns identical content to CLI
- [ ] Context includes field values for traversed nodes when --include-fields is set
- [ ] Relevance scoring puts directly connected nodes higher than 2-hop connections

## Dependencies

- F-097 (Live Read Backend) — provides `TanaReadBackend` for data access
- F-065 (Graph Traversal) — provides relationship walking primitives
- Existing semantic search (optional) — provides embedding similarity for scoring

---
*Spec created: 2026-02-22*
*Replaces: 071-context-building (draft)*
