# Specification: F-105 PAI Memory Integration

## Context
> Identified in the Tana Graph DB dialogue as the "hybrid sync" architecture (Option C).
> Connects pai-seed's learning lifecycle with Tana's knowledge graph for graph-aware AI memory.
> This is a full integration spec covering both the supertag-cli API surface AND the pai-seed consumption patterns.

## Problem Statement

**Core Problem**: pai-seed stores AI learnings (patterns, insights, self-knowledge) as flat JSON entries with no relationships between them. A learning about "Jens-Christian prefers German for internal comms" and an insight about "Switch uses German-language marketing" are stored as disconnected items even though they're clearly related through person and project nodes in Tana.

**Current State**:
- pai-seed stores learnings in `seed.json` as flat arrays with metadata
- pai-seed has propose → confirm → persist lifecycle with extraction quality filtering
- Tana has rich graph structure with #person, #project, #meeting nodes and typed relationships
- supertag-cli can read/write to Tana but has no specific pai-seed integration
- No sync layer between pai-seed learnings and Tana graph nodes

**Impact if Unsolved**: AI learnings remain disconnected from the knowledge context they relate to. Learning freshness is purely temporal (when was it last confirmed?) instead of contextual (is the related project still active?). Cross-referencing learnings requires human effort.

## Users & Stakeholders

**Primary User**: The PAI system (Ivy) — AI memory lifecycle
- Expects: confirmed learnings sync to Tana as connected graph nodes
- Needs: graph-aware freshness scoring, contextual retrieval, relationship linking

**Secondary**:
- Jens-Christian — sees AI learnings in his Tana workspace, connected to relevant context
- Future PAI users — graph-backed memory as a product feature

## Requirements

### Functional Requirements — supertag-cli Side

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Define `#pai_learning` supertag schema: type (pattern/insight/self_knowledge), content, confidence, source, confirmedAt | Must |
| FR-2 | Define `#pai_proposal` supertag schema: status (pending/accepted/rejected), confidence, extractedFrom, decidedAt | Must |
| FR-3 | `supertag pai sync` command: sync confirmed learnings from seed.json → Tana as `#pai_learning` nodes | Must |
| FR-4 | `supertag pai context <topic>` command: retrieve learnings related to a topic using graph context | Must |
| FR-5 | `supertag pai freshness` command: check learning freshness using graph activity (not just timestamps) | Should |
| FR-6 | MCP tools: `tana_pai_sync`, `tana_pai_context`, `tana_pai_freshness` | Must |
| FR-7 | Entity linking: when syncing a learning, resolve and link mentioned people/projects to existing Tana nodes | Must |
| FR-8 | Deduplication: before creating a `#pai_learning` node, check if an equivalent already exists (via F-100 entity resolution) | Must |
| FR-9 | Bidirectional ID mapping: maintain a mapping between seed.json entry IDs and Tana node IDs | Must |
| FR-10 | `supertag pai schema init` command: create the PAI supertags in a workspace if they don't exist | Should |

### Functional Requirements — pai-seed Side

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-11 | Session start hook: load relevant graph context from Tana alongside seed.json learnings | Must |
| FR-12 | Post-confirmation hook: when a proposal is accepted, create/update `#pai_learning` node in Tana | Must |
| FR-13 | Graph-aware freshness: a learning linked to an active project stays fresh regardless of its confirm timestamp | Should |
| FR-14 | Relationship system: replace `rel/` flat files with Tana `#person` node references | Should |
| FR-15 | Config: `tanaIntegration.enabled`, `tanaIntegration.workspace`, `tanaIntegration.autoSync` settings in pai-seed config | Must |

### Functional Requirements — Sync Protocol

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-16 | Sync direction: seed.json → Tana (primary), Tana → seed.json context enrichment (secondary read-only) | Must |
| FR-17 | Conflict resolution: seed.json is source of truth for learning lifecycle state; Tana is source of truth for graph context | Must |
| FR-18 | ID mapping stored in `~/.config/supertag/pai-mapping.json` | Must |
| FR-19 | Sync is idempotent: running twice produces no duplicates | Must |
| FR-20 | Incremental sync: only process learnings added/modified since last sync | Should |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Sync of 100 learnings completes in < 30 seconds |
| NFR-2 | Session start context loading adds < 2 seconds to startup |
| NFR-3 | Works without Tana (graceful degradation — pai-seed continues standalone) |
| NFR-4 | No breaking changes to pai-seed's existing seed.json format |
| NFR-5 | Graph-aware freshness scoring adds < 500ms to staleness checks |

## Architecture

### System Architecture

```
pai-seed (lifecycle engine)                    supertag-cli (graph bridge)
┌────────────────────────────┐                ┌────────────────────────────┐
│ seed.json                  │                │ Tana Knowledge Graph       │
│  - proposals (pending)     │──sync (FR-3)──→│  #pai_learning nodes      │
│  - learnings (active)      │                │   - linked to #person     │
│  - extraction stats        │                │   - linked to #project    │
│  - identity                │                │   - linked to #meeting    │
│                            │←─context(FR-4)─│                            │
│ sessionStartHook:          │                │  Entity resolution        │
│  1. load seed.json         │                │  (F-100) for linking      │
│  2. load Tana context      │                │                            │
│     via supertag pai context│                │  Context assembly         │
│                            │                │  (F-098) for retrieval    │
└────────────────────────────┘                └────────────────────────────┘
```

### PAI Supertag Schema

```typescript
// #pai_learning
interface PaiLearning {
  type: 'pattern' | 'insight' | 'self_knowledge';   // options field
  content: string;                                     // plain field
  confidence: number;                                  // number field (0-10)
  source: string;                                      // plain field
  confirmedAt: string;                                 // date field
  seedEntryId: string;                                 // plain field (maps back to seed.json)
  relatedPeople: string[];                             // instance field → #person (multi)
  relatedProjects: string[];                           // instance field → #project (multi)
}

// #pai_proposal
interface PaiProposal {
  status: 'pending' | 'accepted' | 'rejected';        // options field
  confidence: number;                                   // number field
  extractedFrom: string;                                // plain field
  decidedAt?: string;                                   // date field
  content: string;                                      // plain field
}
```

### Graph-Aware Freshness

Traditional freshness (pai-seed today):
```
freshness = daysSinceConfirmed < threshold ? 'fresh' : 'stale'
```

Graph-aware freshness (with Tana integration):
```
graphActivity = max(
  lastModified(relatedProjects),
  lastModified(relatedPeople),
  lastModified(relatedMeetings)
)
contextualFreshness = max(confirmedAt, graphActivity)
freshness = daysSince(contextualFreshness) < threshold ? 'fresh' : 'stale'
```

A learning about "Project X" stays fresh as long as Project X is actively being worked on in Tana.

### Entity Linking During Sync

When syncing a learning to Tana:
1. Parse learning content for entity mentions (names, project references)
2. Use entity resolution (F-100) to find matching Tana nodes
3. Create instance field links from `#pai_learning` → matched nodes
4. If no match found, skip linking (don't create placeholder nodes)

### ID Mapping

```json
// ~/.config/supertag/pai-mapping.json
{
  "version": 1,
  "workspace": "main",
  "lastSync": "2026-02-22T10:00:00Z",
  "mappings": {
    "seed-entry-abc123": "tana-node-xyz789",
    "seed-entry-def456": "tana-node-uvw321"
  }
}
```

## Scope

### In Scope
- PAI supertag schema definition and initialization
- `supertag pai sync` — learning sync from seed.json to Tana
- `supertag pai context` — graph-aware learning retrieval
- `supertag pai freshness` — contextual freshness scoring
- MCP tools for all three commands
- Entity linking during sync
- ID mapping maintenance
- pai-seed hook integration (session start, post-confirmation)
- Graph-aware freshness scoring

### Explicitly Out of Scope
- Replacing seed.json entirely (it remains the fast local cache)
- Tana → seed.json sync (one-directional: seed → Tana)
- Custom AI models for entity extraction from learning text
- Relationship system migration (`rel/` files → Tana #person — deferred)
- Multi-user support (single PAI instance)

### Designed For But Not Implemented
- `rel/` files → Tana #person migration
- Learning graph visualization (show learning network in Tana)
- Cross-session learning correlation (link learnings that reference each other)
- PKM backend abstraction (F-PKM — future project)

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Tana Desktop not running | Sync queues changes; warns user. pai-seed continues standalone. |
| Learning mentions unknown entity | Skip entity linking for that reference; log info |
| Duplicate learning detected in Tana | Update existing node instead of creating new one |
| seed.json entry deleted but Tana node exists | Trash the Tana node (or mark as archived via field) |
| Tana workspace changed/reset | Detect stale mappings; offer re-sync |
| PAI supertags don't exist yet | `supertag pai schema init` creates them; sync auto-runs init if needed |
| Very large seed.json (1000+ entries) | Paginate sync; show progress bar |
| Network error during entity resolution | Skip entity linking; sync the learning without links |

## Success Criteria

- [ ] `supertag pai schema init` creates #pai_learning and #pai_proposal supertags
- [ ] `supertag pai sync` syncs confirmed learnings from seed.json to Tana
- [ ] Synced learnings appear as #pai_learning nodes in Tana with correct field values
- [ ] Entity mentions in learnings are linked to matching Tana nodes
- [ ] `supertag pai context "project X"` returns learnings related to that project
- [ ] `supertag pai freshness` reports contextual freshness using graph activity
- [ ] ID mapping persists across sync runs (no duplicates)
- [ ] pai-seed session start hook loads Tana context alongside seed.json
- [ ] pai-seed post-confirmation hook creates Tana node for accepted proposals
- [ ] System works without Tana (graceful degradation to standalone pai-seed)

## Dependencies

- F-098 (Context Assembler) — for graph-aware retrieval
- F-100 (Entity Resolution) — for entity linking during sync
- F-097 (Live Read Backend) — for data access
- pai-seed codebase — for hook integration
- Tana Local MCP — for node creation and field setting

---
*Spec created: 2026-02-22*
