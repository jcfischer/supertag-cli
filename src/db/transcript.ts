/**
 * Transcript Data Access Layer
 *
 * Provides functions to access meeting transcripts stored in Tana.
 *
 * Transcript structure in Tana:
 * - Meeting nodes link to transcripts via SYS_A199 field in metanode
 * - Transcript nodes (_docType: "transcript") contain child transcriptLine nodes
 * - Each transcriptLine has metadata in its metanode:
 *   - SYS_A252: Speaker (e.g., "Speaker 1")
 *   - SYS_A253: Start time (ISO format offset from meeting start)
 *   - SYS_A254: End time
 *
 * See: docs/TANA-TRANSCRIPT-STRUCTURE.md
 */

import type { Database } from "bun:sqlite";

/**
 * Summary of a meeting with transcript
 */
export interface TranscriptSummary {
  meetingId: string;
  meetingName: string;
  transcriptId: string;
  lineCount: number;
  created: number | null;
}

/**
 * Individual transcript line with metadata
 */
export interface TranscriptLine {
  id: string;
  text: string;
  speaker: string | null;
  startTime: string | null;
  endTime: string | null;
  order: number;
}

/**
 * Search result for transcript content
 */
export interface TranscriptSearchResult {
  lineId: string;
  lineText: string;
  meetingId: string | null;
  meetingName: string | null;
  speaker: string | null;
  rank: number;
}

/**
 * Check if a docType indicates a transcript node
 */
export function isTranscriptNode(docType: string | null | undefined): boolean {
  return docType === "transcript" || docType === "transcriptLine";
}

/**
 * Format transcript timestamp to human-readable MM:SS format
 *
 * Transcript timestamps use 1970-01-01T00:35:58.004Z format where
 * the time portion represents offset from meeting start.
 *
 * @param isoString - ISO timestamp (e.g., "1970-01-01T00:35:58.004Z")
 * @returns Formatted time string (e.g., "35:58")
 */
export function formatTranscriptTime(isoString: string): string {
  const date = new Date(isoString);
  const totalMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  return `${totalMinutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Get transcript ID linked to a meeting via SYS_A199 metanode field
 *
 * @param db - Database connection
 * @param meetingId - Meeting node ID
 * @returns Transcript node ID or null if not found
 */
export function getTranscriptForMeeting(
  db: Database,
  meetingId: string
): string | null {
  // Query to resolve SYS_A199 metanode link from meeting to transcript
  // Pattern: Meeting → Metanode (_ownerId=Meeting) → Tuple (children[0]='SYS_A199') → Transcript
  const result = db
    .query(
      `
      SELECT v.id as transcript_id
      FROM nodes m
      JOIN nodes meta ON json_extract(meta.raw_data, '$.props._ownerId') = m.id
        AND json_extract(meta.raw_data, '$.props._docType') = 'metanode'
      JOIN json_each(json_extract(meta.raw_data, '$.children')) as c
      JOIN nodes t ON t.id = c.value
      JOIN nodes v ON v.id = json_extract(t.raw_data, '$.children[1]')
      WHERE m.id = ?
        AND json_extract(t.raw_data, '$.children[0]') = 'SYS_A199'
      LIMIT 1
    `
    )
    .get(meetingId) as { transcript_id: string } | null;

  return result?.transcript_id ?? null;
}

/**
 * Get all transcript lines for a transcript, with metadata
 *
 * Optimized: Gets lines first, then batch-fetches metadata.
 *
 * @param db - Database connection
 * @param transcriptId - Transcript node ID
 * @returns Array of transcript lines in order
 */
export function getTranscriptLines(
  db: Database,
  transcriptId: string
): TranscriptLine[] {
  // Step 1: Get transcript children (line IDs) with their text
  const lines = db
    .query(
      `
      SELECT
        c.value as id,
        c.key as line_order,
        n.name as text
      FROM nodes t
      JOIN json_each(json_extract(t.raw_data, '$.children')) as c
      JOIN nodes n ON n.id = c.value
      WHERE t.id = ?
        AND json_extract(t.raw_data, '$.props._docType') = 'transcript'
      ORDER BY c.key
    `
    )
    .all(transcriptId) as Array<{
    id: string;
    line_order: number;
    text: string;
  }>;

  if (lines.length === 0) {
    return [];
  }

  // Step 2: Batch fetch metadata for all lines at once
  // Use IN clause with collected IDs
  const lineIds = lines.map((l) => l.id);
  const placeholders = lineIds.map(() => "?").join(", ");

  const metadata = db
    .query(
      `
      SELECT
        json_extract(meta.raw_data, '$.props._ownerId') as line_id,
        MAX(CASE WHEN json_extract(tuple.raw_data, '$.children[0]') = 'SYS_A252' THEN val.name END) as speaker,
        MAX(CASE WHEN json_extract(tuple.raw_data, '$.children[0]') = 'SYS_A253' THEN val.name END) as start_time,
        MAX(CASE WHEN json_extract(tuple.raw_data, '$.children[0]') = 'SYS_A254' THEN val.name END) as end_time
      FROM nodes meta
      JOIN json_each(json_extract(meta.raw_data, '$.children')) as mc
      JOIN nodes tuple ON tuple.id = mc.value
      LEFT JOIN nodes val ON val.id = json_extract(tuple.raw_data, '$.children[1]')
      WHERE json_extract(meta.raw_data, '$.props._docType') = 'metanode'
        AND json_extract(meta.raw_data, '$.props._ownerId') IN (${placeholders})
      GROUP BY json_extract(meta.raw_data, '$.props._ownerId')
    `
    )
    .all(...lineIds) as Array<{
    line_id: string;
    speaker: string | null;
    start_time: string | null;
    end_time: string | null;
  }>;

  // Create lookup map
  const metadataMap = new Map(metadata.map((m) => [m.line_id, m]));

  // Combine lines with metadata
  return lines.map((line, idx) => {
    const meta = metadataMap.get(line.id);
    return {
      id: line.id,
      text: line.text,
      speaker: meta?.speaker ?? null,
      startTime: meta?.start_time ?? null,
      endTime: meta?.end_time ?? null,
      order: idx,
    };
  });
}

/**
 * Get speaker and timing metadata for a transcript line
 */
function getLineMetadata(
  db: Database,
  lineId: string
): { speaker: string | null; startTime: string | null; endTime: string | null } {
  // Query metanode for SYS_A252 (speaker), SYS_A253 (start), SYS_A254 (end)
  const result = db
    .query(
      `
      SELECT
        MAX(CASE WHEN json_extract(t.raw_data, '$.children[0]') = 'SYS_A252' THEN v.name END) as speaker,
        MAX(CASE WHEN json_extract(t.raw_data, '$.children[0]') = 'SYS_A253' THEN v.name END) as start_time,
        MAX(CASE WHEN json_extract(t.raw_data, '$.children[0]') = 'SYS_A254' THEN v.name END) as end_time
      FROM nodes meta
      JOIN json_each(json_extract(meta.raw_data, '$.children')) as c
      JOIN nodes t ON t.id = c.value
      LEFT JOIN nodes v ON v.id = json_extract(t.raw_data, '$.children[1]')
      WHERE json_extract(meta.raw_data, '$.props._ownerId') = ?
        AND json_extract(meta.raw_data, '$.props._docType') = 'metanode'
    `
    )
    .get(lineId) as {
    speaker: string | null;
    start_time: string | null;
    end_time: string | null;
  } | null;

  return {
    speaker: result?.speaker ?? null,
    startTime: result?.start_time ?? null,
    endTime: result?.end_time ?? null,
  };
}

/**
 * Get all meetings that have associated transcripts
 *
 * @param db - Database connection
 * @param options - Query options
 * @returns Array of meeting summaries with transcript info
 */
export function getMeetingsWithTranscripts(
  db: Database,
  options: { limit?: number; offset?: number } = {}
): TranscriptSummary[] {
  const { limit = 50, offset = 0 } = options;

  // Find all meetings that have SYS_A199 (transcript) links
  const results = db
    .query(
      `
      SELECT
        m.id as meeting_id,
        m.name as meeting_name,
        m.created,
        v.id as transcript_id,
        (
          SELECT COUNT(*)
          FROM json_each(json_extract(v.raw_data, '$.children'))
        ) as line_count
      FROM nodes m
      JOIN nodes meta ON json_extract(meta.raw_data, '$.props._ownerId') = m.id
        AND json_extract(meta.raw_data, '$.props._docType') = 'metanode'
      JOIN json_each(json_extract(meta.raw_data, '$.children')) as c
      JOIN nodes t ON t.id = c.value
      JOIN nodes v ON v.id = json_extract(t.raw_data, '$.children[1]')
        AND json_extract(v.raw_data, '$.props._docType') = 'transcript'
      WHERE json_extract(t.raw_data, '$.children[0]') = 'SYS_A199'
      ORDER BY m.created DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(limit, offset) as Array<{
    meeting_id: string;
    meeting_name: string | null;
    created: number | null;
    transcript_id: string;
    line_count: number;
  }>;

  return results.map((r) => ({
    meetingId: r.meeting_id,
    meetingName: r.meeting_name ?? "(unnamed)",
    transcriptId: r.transcript_id,
    lineCount: r.line_count,
    created: r.created,
  }));
}

/**
 * Search within transcript content only
 *
 * Uses FTS to search transcriptLine nodes, returns results with speaker info.
 * Meeting context is fetched in a separate batch query for performance.
 *
 * @param db - Database connection
 * @param query - Search query
 * @param options - Query options
 * @returns Array of search results
 */
export function searchTranscripts(
  db: Database,
  query: string,
  options: { limit?: number } = {}
): TranscriptSearchResult[] {
  const { limit = 20 } = options;

  // Check if FTS index exists
  const hasFTS = db
    .query(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='nodes_fts'`
    )
    .get();

  if (!hasFTS) {
    // Fall back to LIKE search if FTS not available
    return searchTranscriptsWithLike(db, query, limit);
  }

  // Step 1: FTS search for matching transcript lines
  const matched = db
    .query(
      `
      SELECT
        n.id as line_id,
        n.name as line_text,
        fts.rank
      FROM nodes_fts fts
      JOIN nodes n ON n.rowid = fts.rowid
      WHERE nodes_fts MATCH ?
        AND json_extract(n.raw_data, '$.props._docType') = 'transcriptLine'
      ORDER BY fts.rank
      LIMIT ?
    `
    )
    .all(query, limit) as Array<{
    line_id: string;
    line_text: string;
    rank: number;
  }>;

  if (matched.length === 0) {
    return [];
  }

  // Step 2: Batch fetch speaker metadata
  const lineIds = matched.map((m) => m.line_id);
  const placeholders = lineIds.map(() => "?").join(", ");

  const metadata = db
    .query(
      `
      SELECT
        json_extract(meta.raw_data, '$.props._ownerId') as line_id,
        MAX(CASE WHEN json_extract(tuple.raw_data, '$.children[0]') = 'SYS_A252' THEN val.name END) as speaker
      FROM nodes meta
      JOIN json_each(json_extract(meta.raw_data, '$.children')) as mc
      JOIN nodes tuple ON tuple.id = mc.value
      LEFT JOIN nodes val ON val.id = json_extract(tuple.raw_data, '$.children[1]')
      WHERE json_extract(meta.raw_data, '$.props._docType') = 'metanode'
        AND json_extract(meta.raw_data, '$.props._ownerId') IN (${placeholders})
      GROUP BY json_extract(meta.raw_data, '$.props._ownerId')
    `
    )
    .all(...lineIds) as Array<{
    line_id: string;
    speaker: string | null;
  }>;

  const speakerMap = new Map(metadata.map((m) => [m.line_id, m.speaker]));

  // Return results without meeting context for now (can be added if needed)
  return matched.map((r) => ({
    lineId: r.line_id,
    lineText: r.line_text,
    meetingId: null,
    meetingName: null,
    speaker: speakerMap.get(r.line_id) ?? null,
    rank: r.rank,
  }));
}

/**
 * Fallback search using LIKE when FTS is not available
 * Simplified version without meeting context for performance
 */
function searchTranscriptsWithLike(
  db: Database,
  query: string,
  limit: number
): TranscriptSearchResult[] {
  // Single query with speaker metadata
  const results = db
    .query(
      `
      WITH matched_lines AS (
        SELECT
          n.id as line_id,
          n.name as line_text
        FROM nodes n
        WHERE json_extract(n.raw_data, '$.props._docType') = 'transcriptLine'
          AND n.name LIKE ?
        LIMIT ?
      )
      SELECT
        ml.line_id,
        ml.line_text,
        MAX(CASE WHEN json_extract(tuple.raw_data, '$.children[0]') = 'SYS_A252' THEN val.name END) as speaker
      FROM matched_lines ml
      LEFT JOIN nodes meta ON json_extract(meta.raw_data, '$.props._ownerId') = ml.line_id
        AND json_extract(meta.raw_data, '$.props._docType') = 'metanode'
      LEFT JOIN json_each(json_extract(meta.raw_data, '$.children')) as mc
      LEFT JOIN nodes tuple ON tuple.id = mc.value
      LEFT JOIN nodes val ON val.id = json_extract(tuple.raw_data, '$.children[1]')
      GROUP BY ml.line_id, ml.line_text
    `
    )
    .all(`%${query}%`, limit) as Array<{
    line_id: string;
    line_text: string;
    speaker: string | null;
  }>;

  return results.map((r) => ({
    lineId: r.line_id,
    lineText: r.line_text,
    meetingId: null,
    meetingName: null,
    speaker: r.speaker,
    rank: 0,
  }));
}

/**
 * Get meeting that owns a transcript
 */
function getMeetingForTranscript(
  db: Database,
  transcriptId: string
): { id: string; name: string } | null {
  // Find the meeting that has SYS_A199 pointing to this transcript
  const result = db
    .query(
      `
      SELECT m.id, m.name
      FROM nodes m
      JOIN nodes meta ON json_extract(meta.raw_data, '$.props._ownerId') = m.id
        AND json_extract(meta.raw_data, '$.props._docType') = 'metanode'
      JOIN json_each(json_extract(meta.raw_data, '$.children')) as c
      JOIN nodes t ON t.id = c.value
      WHERE json_extract(t.raw_data, '$.children[0]') = 'SYS_A199'
        AND json_extract(t.raw_data, '$.children[1]') = ?
      LIMIT 1
    `
    )
    .get(transcriptId) as { id: string; name: string } | null;

  return result;
}
