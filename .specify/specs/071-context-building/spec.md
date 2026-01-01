---
id: "071"
feature: "Context Building"
status: "draft"
created: "2026-01-01"
---

# Specification: Context Building

## Overview

Add intelligent context building capabilities that help AI agents gather relevant information while respecting token budgets. Enables smart aggregation of related nodes, automatic relevance scoring, and budget-aware retrieval.

## User Scenarios

### Scenario 1: Build Context for Topic

**As an** AI agent answering a question about a project
**I want to** gather all relevant context efficiently
**So that** I have comprehensive information without exceeding token limits

**Acceptance Criteria:**
- [ ] `tana_context` builds context from a starting node
- [ ] Automatically traverses related nodes
- [ ] Respects token budget parameter
- [ ] Prioritizes most relevant information
- [ ] Returns structured context bundle

### Scenario 2: Token-Budget Aware Retrieval

**As an** AI agent with limited context window
**I want to** specify a token budget
**So that** I get maximum value within my constraints

**Acceptance Criteria:**
- [ ] `--budget 4000` limits total tokens
- [ ] Most relevant items included first
- [ ] Truncation happens gracefully
- [ ] Reports what was included vs excluded

### Scenario 3: Multi-Source Context

**As an** AI agent needing comprehensive context
**I want to** gather from multiple starting points
**So that** I get a complete picture

**Acceptance Criteria:**
- [ ] Can specify multiple seed nodes
- [ ] Deduplicates overlapping context
- [ ] Merges related information intelligently
- [ ] Maintains coherent structure

### Scenario 4: Context Templates

**As a** developer building AI workflows
**I want to** define reusable context patterns
**So that** I consistently gather the right information

**Acceptance Criteria:**
- [ ] Define context template: "project context" includes tasks, meetings, people
- [ ] Templates specify what relationships to follow
- [ ] Templates can have default token budgets
- [ ] Templates are reusable across nodes

## Functional Requirements

### FR-1: Context Tool/Command

MCP tool and CLI command for context building:

```typescript
// MCP
tana_context({
  seeds: ["nodeA-id", "nodeB-id"],      // Starting nodes
  budget: 4000,                          // Token budget
  strategy: "relevance",                 // "relevance" | "breadth" | "depth"
  include: {
    children: true,
    references: true,
    fields: true,
    related: { depth: 2 }
  },
  exclude: {
    tags: ["archive"],                   // Skip archived items
    olderThan: "1y"                      // Skip old content
  },
  format: "structured"                   // "structured" | "narrative" | "outline"
})

// CLI
supertag context <nodeId> --budget 4000
supertag context <nodeId> --strategy depth --include-references
```

**Validation:** Returns context bundle within token budget.

### FR-2: Token Estimation

Accurately estimate token usage:

**Validation:**
- Count tokens using tiktoken or similar
- Track cumulative tokens as context builds
- Reserve tokens for structure/formatting
- Report actual vs estimated tokens

### FR-3: Relevance Scoring

Score items for prioritization:

| Factor | Weight | Description |
|--------|--------|-------------|
| Distance | 30% | Closer to seed = higher score |
| Recency | 20% | More recent = higher score |
| References | 20% | More referenced = higher score |
| Type | 15% | Entities > plain nodes |
| Content | 15% | Semantic similarity to query |

**Validation:**
- Items sorted by relevance score
- High-priority items included first
- Score available in response

### FR-4: Traversal Strategies

Support different context gathering strategies:

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `relevance` | Score-based prioritization | General context building |
| `breadth` | Explore widely, shallow depth | Overview/discovery |
| `depth` | Follow chains deeply | Detailed investigation |
| `semantic` | Similarity-based expansion | Topic-focused context |

**Validation:** Strategy affects traversal behavior.

### FR-5: Context Response Structure

Structured context bundle:

```typescript
{
  query: {
    seeds: ["nodeA-id"],
    budget: 4000,
    strategy: "relevance"
  },
  context: {
    primary: {
      node: { id: "nodeA", name: "Project Alpha", ... },
      fields: { Status: "Active", Owner: "John" },
      content: "Project description..."
    },
    related: [
      {
        node: { id: "nodeB", ... },
        relationship: "child",
        relevanceScore: 0.85,
        distance: 1
      }
    ],
    references: [...],
    timeline: [...]                      // Recent activity
  },
  metadata: {
    tokensUsed: 3842,
    tokensBudget: 4000,
    itemsIncluded: 23,
    itemsExcluded: 45,
    truncated: false
  },
  excluded: [                            // What didn't fit
    { id: "nodeX", reason: "budget", score: 0.42 }
  ]
}
```

**Validation:** Response includes all metadata for transparency.

### FR-6: Context Templates

Define reusable context patterns:

```json
// ~/.config/supertag/context-templates.json
{
  "project-context": {
    "description": "Full project context for AI",
    "budget": 8000,
    "strategy": "relevance",
    "include": {
      "children": true,
      "references": true,
      "related": { "depth": 2, "tags": ["task", "meeting", "person"] }
    },
    "exclude": {
      "tags": ["archive", "draft"]
    },
    "format": "structured"
  }
}
```

**CLI usage:**
```bash
supertag context <nodeId> --template project-context
```

**Validation:** Templates simplify repeated context gathering.

### FR-7: Incremental Context

Add to existing context:

```typescript
// Add more context without duplicates
tana_context({
  seeds: ["nodeC-id"],
  existingContext: previousContextResult,
  additionalBudget: 2000
})
```

**Validation:** Incrementally expand context without duplicates.

## Non-Functional Requirements

- **Performance:** Build 4K token context in < 1s
- **Accuracy:** Token estimation within 5% of actual
- **Memory:** Stream processing for large graphs

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| ContextQuery | Context request | `seeds`, `budget`, `strategy` |
| ContextBundle | Result package | `primary`, `related`, `metadata` |
| RelevanceScore | Item priority | `score`, `factors` |
| ContextTemplate | Reusable pattern | `name`, `config` |

## Success Criteria

- [ ] AI agents can gather context without exceeding token limits
- [ ] Most relevant information prioritized correctly
- [ ] Templates enable consistent context gathering
- [ ] Token estimates are accurate

## Assumptions

- Token estimation library is available
- Relevance scoring is good enough without ML
- Users understand token budget concepts

## [NEEDS CLARIFICATION]

- Should we support different tokenizers for different models?
- Should context be cacheable for repeated queries?
- How to handle multimedia content (images, files)?

## Out of Scope

- Fine-tuned relevance models
- Cross-workspace context
- Real-time context updates
- Context compression/summarization
- Embedding-based semantic expansion
