---
id: "023"
feature: "Transcript Filtering and Commands"
status: "completed"
created: "2025-12-25"
completed: "2025-12-25"
---

# Specification: Transcript Filtering and Commands

## Overview

Meeting transcripts in Tana represent 6.7% of all nodes (90,960 transcript lines) but contain low-semantic-value spoken language (filler words, fragments, "um", "äh"). This feature excludes transcripts from general search/embeddings by default while providing dedicated commands for targeted transcript access.

## User Scenarios

### Scenario 1: Clean Search Results

**As a** Tana user searching for content
**I want to** get search results without transcript noise
**So that** I find relevant notes and documents, not random spoken fragments

**Acceptance Criteria:**
- [x] Running `supertag search "meeting"` returns meeting nodes, not transcript lines containing "meeting"
- [x] Running `supertag semantic-search "budget"` returns budget-related notes, not transcript mentions
- [x] Search results count decreases by approximately 90K when transcripts excluded

### Scenario 2: Intentional Transcript Search

**As a** user looking for something mentioned in a meeting
**I want to** explicitly include transcripts in my search
**So that** I can find where specific topics were discussed verbally

**Acceptance Criteria:**
- [x] Running `supertag search "pricing" --include-transcripts` returns both notes and transcript lines
- [x] Transcript results are clearly identified as transcript content
- [x] Performance remains acceptable with 90K additional nodes to search

### Scenario 3: View Meeting Transcript

**As a** user reviewing a past meeting
**I want to** view the full transcript of a specific meeting
**So that** I can recall what was discussed

**Acceptance Criteria:**
- [x] Running `supertag transcript show <meeting-id>` displays the complete transcript
- [x] Transcript shows speaker information when available
- [x] Transcript shows timestamps/timing when available
- [x] Output is readable and properly formatted

### Scenario 4: Find Meetings with Transcripts

**As a** user wanting to review meeting recordings
**I want to** list all meetings that have transcripts
**So that** I know which meetings I can review

**Acceptance Criteria:**
- [x] Running `supertag transcript list` shows all meetings with associated transcripts
- [x] List includes meeting name, date, and transcript line count
- [x] Results are sorted by date (most recent first)

### Scenario 5: Search Within Transcripts Only

**As a** user looking for a specific discussion
**I want to** search only within transcript content
**So that** I can find when/where something was said in meetings

**Acceptance Criteria:**
- [x] Running `supertag transcript search "quarterly review"` searches only transcript lines
- [x] Results show which meeting the match came from
- [x] Results show context (surrounding text or timestamp)

### Scenario 6: Efficient Embeddings

**As a** user generating semantic search embeddings
**I want to** exclude transcript noise from embeddings by default
**So that** semantic search returns meaningful results, not spoken fragments

**Acceptance Criteria:**
- [x] Running `supertag embed generate` excludes transcriptLine nodes by default
- [x] Embedding count decreases by ~90K compared to including transcripts
- [x] Embedding quality improves (search results more relevant)
- [x] Optional `--include-transcripts` flag allows including them

## Functional Requirements

### FR-1: Exclude Transcripts from Default Search

The `search` command must exclude nodes with `_docType` of `transcript` or `transcriptLine` by default.

**Validation:** Run search for common word, verify no transcriptLine results in output

### FR-2: Exclude Transcripts from Default Semantic Search

The `semantic-search` command must exclude transcript content from results by default.

**Validation:** Run semantic search, verify results don't include transcript fragments

### FR-3: Exclude Transcripts from Default Embedding Generation

The `embed generate` command must exclude `transcriptLine` nodes from embedding by default.

**Validation:** Compare embedding count with/without transcripts, verify ~90K difference

### FR-4: Include Transcripts Flag

All search commands must support `--include-transcripts` flag to include transcript content.

**Validation:** Run search with flag, verify transcript lines appear in results

### FR-5: Transcript List Command

New `transcript list` command must show all meetings with associated transcripts.

**Validation:** Run command, verify output shows meeting names, dates, line counts

### FR-6: Transcript Show Command

New `transcript show <meeting-id>` command must display full transcript with speaker/timing metadata.

**Validation:** Run command with known meeting ID, verify complete transcript output

### FR-7: Transcript Search Command

New `transcript search <query>` command must search only within transcript content.

**Validation:** Run command, verify results only come from transcriptLine nodes

### FR-8: Meeting-Transcript Linking

System must resolve transcript for a meeting via the SYS_A199 field in the meeting's metanode.

**Validation:** Query meeting with known transcript, verify correct transcript is resolved

## Non-Functional Requirements

- **Performance:** Transcript list should complete in <2s for 300+ transcripts
- **Performance:** Transcript show should complete in <1s for transcripts up to 500 lines
- **Performance:** Search with --include-transcripts should complete in <5s
- **Usability:** Transcript output should be human-readable with clear speaker delineation
- **Consistency:** All transcript-related options should use consistent naming (`--include-transcripts`)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| Transcript | Container node for meeting transcript | `_docType: "transcript"`, children (line IDs) |
| TranscriptLine | Individual spoken segment | `_docType: "transcriptLine"`, name (text) |
| Meeting | Meeting node with transcript link | SYS_A199 field in metanode → transcript ID |
| TranscriptMetadata | Per-line speaker/timing info | SYS_A252 (speaker), SYS_A253 (start), SYS_A254 (end) |

## Success Criteria

- [x] Default search results exclude 90K+ transcript lines
- [x] `transcript list` shows all 321 meetings with transcripts
- [x] `transcript show` correctly displays transcript for any meeting
- [x] `transcript search` returns relevant results with meeting context
- [x] Embedding generation excludes transcripts, reducing index size
- [x] All existing tests continue to pass
- [x] New functionality has >80% test coverage

## Assumptions

- Meeting-transcript linking via SYS_A199 is consistent across all meetings
- Transcript metadata (speaker, timing) uses SYS_A252/253/254 consistently
- Transcript line order in children array matches temporal order
- Users primarily want clean search by default (transcripts are noise)

## [NEEDS CLARIFICATION]

- Should `transcript search` support semantic search or just text search?
  -> both
- Should transcript show support pagination for very long transcripts?
  -> no
- Should there be a `transcript export` command for exporting to file formats?
  -> no
- Should speaker names be resolved from SYS_A150 mappings or shown as-is ("Speaker 1")?
  -> yes, if available

## Out of Scope

- Transcript creation/import (Tana handles this)
- Audio/video playback integration
- Real-time transcript sync
- Transcript editing or annotation
- Translation of transcript content
- Summarization of transcripts (separate AI feature)
