---
feature: "Transcript Filtering and Commands"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Transcript Filtering and Commands

## Architecture Overview

This feature adds transcript filtering to existing search/embed commands and introduces dedicated transcript commands. The design follows the existing command pattern with a new data access layer for transcript-specific queries.

```
                    ┌─────────────────────────────────────────┐
                    │              CLI Layer                  │
                    ├─────────────────────────────────────────┤
                    │  search.ts      embed.ts   transcript.ts│
                    │  (modified)     (modified)   (NEW)      │
                    └──────────────────┬──────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │           Content Filter Layer          │
                    ├─────────────────────────────────────────┤
                    │  content-filter.ts (modified)           │
                    │  - SYSTEM_DOC_TYPES += transcript,      │
                    │                       transcriptLine    │
                    │  - --include-transcripts flag support   │
                    └──────────────────┬──────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │           Data Access Layer             │
                    ├─────────────────────────────────────────┤
                    │  transcript.ts (NEW)                    │
                    │  - getTranscriptForMeeting()            │
                    │  - getTranscriptLines()                 │
                    │  - getMeetingsWithTranscripts()         │
                    │  - searchTranscripts()                  │
                    └──────────────────┬──────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │              Database                   │
                    ├─────────────────────────────────────────┤
                    │  nodes table                            │
                    │  - _docType: transcript, transcriptLine │
                    │  - Metanodes with SYS_A199, A252-254    │
                    └─────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Database | SQLite | Already used for all queries |
| CLI Framework | Commander.js | Consistent with existing commands |
| Output Format | JSON + TSV + Pretty | Consistent with search.ts pattern |

## Constitutional Compliance

- [x] **CLI-First:** Exposes `supertag transcript list|show|search` commands
- [x] **Library-First:** Core logic in `src/db/transcript.ts` as reusable module
- [x] **Test-First:** TDD approach - tests written before implementation
- [x] **Deterministic:** No probabilistic behavior - SQL queries with defined results
- [x] **Code Before Prompts:** All logic in code, no AI prompts involved

## Data Model

### Existing Entities (from docs/TANA-TRANSCRIPT-STRUCTURE.md)

```typescript
// Already tracked in database via indexing
interface TranscriptNode {
  id: string;
  name: "Transcript";
  _docType: "transcript";
  children: string[];  // Array of transcriptLine IDs
}

interface TranscriptLineNode {
  id: string;
  name: string;        // The spoken text
  _docType: "transcriptLine";
}

// Metadata extracted via metanode → tuple pattern
interface TranscriptLineMetadata {
  speaker: string;     // SYS_A252 value
  startTime: string;   // SYS_A253 value (1970-01-01T00:35:58.004Z format)
  endTime: string;     // SYS_A254 value
}
```

### Data Access Types

```typescript
// src/db/transcript.ts

interface TranscriptSummary {
  meetingId: string;
  meetingName: string;
  transcriptId: string;
  lineCount: number;
  created: number;
}

interface TranscriptLine {
  id: string;
  text: string;
  speaker: string | null;
  startTime: string | null;
  endTime: string | null;
  order: number;
}

interface TranscriptSearchResult {
  lineId: string;
  lineText: string;
  meetingId: string;
  meetingName: string;
  speaker: string | null;
  rank: number;
}
```

### Database Schema

No schema changes required. Uses existing:
- `nodes` table with `_docType` filtering
- `nodes_fts` for transcript text search
- Metanode queries for SYS_A199 and SYS_A252-254 resolution

## API Contracts

### Internal APIs (src/db/transcript.ts)

```typescript
/**
 * Get transcript ID linked to a meeting via SYS_A199
 */
function getTranscriptForMeeting(
  db: Database,
  meetingId: string
): string | null;

/**
 * Get all transcript lines with metadata
 */
function getTranscriptLines(
  db: Database,
  transcriptId: string
): TranscriptLine[];

/**
 * Get all meetings that have associated transcripts
 */
function getMeetingsWithTranscripts(
  db: Database,
  options?: { limit?: number; offset?: number }
): TranscriptSummary[];

/**
 * Search within transcript content only
 */
function searchTranscripts(
  db: Database,
  query: string,
  options?: { limit?: number }
): TranscriptSearchResult[];

/**
 * Check if a node is a transcript or transcript line
 */
function isTranscriptNode(docType: string | null): boolean;
```

### CLI Commands (src/commands/transcript.ts)

```
supertag transcript list [--limit N] [--json]
supertag transcript show <meeting-id> [--json]
supertag transcript search <query> [--limit N] [--json]
```

## Implementation Strategy

### Phase 1: Foundation (Filter Changes)

Move transcript exclusion to default behavior:

1. Modify `src/embeddings/content-filter.ts`:
   - Move `transcript` and `transcriptLine` from `CONTENT_DOC_TYPES` to `SYSTEM_DOC_TYPES`
   - This automatically excludes them from default embedding generation

2. Add transcript filter option to `ContentFilterOptions`:
   ```typescript
   interface ContentFilterOptions {
     // ... existing options
     includeTranscripts?: boolean;  // NEW: opt-in for transcripts
   }
   ```

3. Update `buildContentFilterQuery()` to handle `--include-transcripts` flag

### Phase 2: Core Features (Data Access Layer)

Create new data access module:

1. Create `src/db/transcript.ts` with functions:
   - `getTranscriptForMeeting()` - Resolve SYS_A199 metanode link
   - `getTranscriptLines()` - Get lines with SYS_A252-254 metadata
   - `getMeetingsWithTranscripts()` - List meetings with transcript count
   - `searchTranscripts()` - FTS search on transcriptLine nodes

2. SQL queries leverage existing metanode pattern (see docs/TANA-TRANSCRIPT-STRUCTURE.md)

### Phase 3: CLI Commands

Create transcript command group:

1. Create `src/commands/transcript.ts`:
   - `transcript list` - Show meetings with transcripts
   - `transcript show <meeting-id>` - Display full transcript
   - `transcript search <query>` - Search within transcripts

2. Wire into `src/index.ts` main CLI

### Phase 4: Integration

Update existing commands:

1. Add `--include-transcripts` flag to:
   - `supertag search` (FTS and semantic)
   - `supertag embed generate`

2. Update MCP tools for consistency:
   - `tana_search` - Add includeTranscripts option
   - `tana_semantic_search` - Add includeTranscripts option

## File Structure

```
src/
├── db/
│   └── transcript.ts           # [NEW] Transcript data access
├── embeddings/
│   └── content-filter.ts       # [MODIFIED] Move transcripts to excluded
├── commands/
│   ├── transcript.ts           # [NEW] transcript command group
│   ├── search.ts               # [MODIFIED] Add --include-transcripts
│   └── embed.ts                # [MODIFIED] Add --include-transcripts
├── mcp/
│   └── tools/
│       └── search.ts           # [MODIFIED] Add includeTranscripts option
└── index.ts                    # [MODIFIED] Register transcript command

tests/
├── db/
│   └── transcript.test.ts      # [NEW] Unit tests
└── commands/
    └── transcript.test.ts      # [NEW] CLI integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance with 90K transcript lines | Medium | Low | Use indexed FTS queries, limit results |
| SYS_A199 metanode resolution complexity | Medium | Medium | Reuse existing field-values.ts patterns |
| Breaking existing search behavior | High | Low | Default exclusion is additive; tests verify |
| Speaker name resolution | Low | Medium | Start with raw "Speaker 1" values, enhance later |

## Dependencies

### External

None required - uses existing dependencies.

### Internal

- `src/db/field-values.ts` - SYSTEM_FIELD_NAMES for SYS_A* lookup
- `src/embeddings/content-filter.ts` - Filter infrastructure
- `src/commands/helpers.ts` - addStandardOptions, formatJsonOutput
- `src/utils/format.ts` - tsv, EMOJI, header, tip

## Migration/Deployment

- [x] Database migrations needed? **No** - uses existing schema
- [ ] Environment variables? **No**
- [ ] Breaking changes? **Yes, but beneficial** - Search results will exclude 90K noisy transcript lines by default. Users wanting transcripts use `--include-transcripts`.

### Upgrade Path

1. Users run `supertag sync` (no changes needed)
2. New `transcript` commands immediately available
3. Search results automatically cleaner (transcripts excluded)
4. `supertag embed generate` will need to be re-run for cleaner embeddings

## Estimated Complexity

- **New files:** 2 (transcript.ts, transcript command)
- **Modified files:** 5 (content-filter, search, embed, index, MCP search)
- **Test files:** 2 (unit + integration)
- **Estimated tasks:** ~12-15

## Key Implementation Details

### Metanode Query Pattern for SYS_A199

```sql
-- Get transcript ID from meeting's metanode
SELECT v.id as transcript_id
FROM nodes m
JOIN nodes meta ON json_extract(meta.raw_data, '$.props._ownerId') = m.id
JOIN nodes t ON t.id IN (SELECT value FROM json_each(json_extract(meta.raw_data, '$.children')))
JOIN nodes v ON v.id = json_extract(t.raw_data, '$.children[1]')
WHERE m.id = ?
  AND json_extract(t.raw_data, '$.children[0]') = 'SYS_A199';
```

### Timestamp Formatting

Transcript timestamps use `1970-01-01T00:35:58.004Z` format where time represents offset from meeting start. Display should convert to `35:58` format.

```typescript
function formatTranscriptTime(isoString: string): string {
  const date = new Date(isoString);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
```

## Clarifications Needed (from spec)

Per spec.md [NEEDS CLARIFICATION] section:

1. **Transcript search type**: Implementing text search (FTS) first. Semantic search can be added later.
2. **Pagination**: Not implementing for v1. Long transcripts display fully (can add --limit later).
3. **Export command**: Out of scope for initial implementation.
4. **Speaker names**: Using raw values ("Speaker 1") initially. SYS_A150 resolution can be added later.
