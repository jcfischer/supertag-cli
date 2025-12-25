/**
 * MCP Transcript Tools
 *
 * Tools for accessing meeting transcripts stored in Tana.
 * - tana_transcript_list: List meetings with transcripts
 * - tana_transcript_show: Show transcript content for a meeting
 * - tana_transcript_search: Search within transcript content
 */

import { Database } from "bun:sqlite";
import { resolveWorkspace } from "../../config/paths.js";
import { ConfigManager } from "../../config/manager.js";
import {
  getMeetingsWithTranscripts,
  getTranscriptForMeeting,
  getTranscriptLines,
  searchTranscripts,
  formatTranscriptTime,
  type TranscriptSummary,
  type TranscriptLine,
  type TranscriptSearchResult,
} from "../../db/transcript.js";
import type {
  TranscriptListInput,
  TranscriptShowInput,
  TranscriptSearchInput,
} from "../schemas.js";

// Response types
export interface TranscriptListResult {
  workspace: string;
  meetings: TranscriptSummary[];
  count: number;
}

export interface TranscriptShowResult {
  workspace: string;
  meeting: {
    id: string;
    name: string | null;
  };
  lines: Array<{
    id: string;
    text: string;
    speaker: string | null;
    startTime: string | null;
    endTime: string | null;
    order: number;
  }>;
  count: number;
}

export interface TranscriptSearchResult {
  workspace: string;
  query: string;
  results: Array<{
    lineId: string;
    lineText: string;
    speaker: string | null;
    meetingId: string | null;
    meetingName: string | null;
  }>;
  count: number;
}

/**
 * List meetings with transcripts
 */
export async function transcriptList(
  input: TranscriptListInput
): Promise<TranscriptListResult> {
  const config = ConfigManager.getInstance().getConfig();
  const workspace = resolveWorkspace(input.workspace, config);

  const db = new Database(workspace.dbPath, { readonly: true });

  try {
    const meetings = getMeetingsWithTranscripts(db, {
      limit: input.limit || 20,
    });

    return {
      workspace: workspace.alias,
      meetings,
      count: meetings.length,
    };
  } finally {
    db.close();
  }
}

/**
 * Show transcript content for a meeting
 */
export async function transcriptShow(
  input: TranscriptShowInput
): Promise<TranscriptShowResult> {
  const config = ConfigManager.getInstance().getConfig();
  const workspace = resolveWorkspace(input.workspace, config);

  const db = new Database(workspace.dbPath, { readonly: true });

  try {
    // Try to get transcript for meeting ID, or use ID directly as transcript ID
    let transcriptId = getTranscriptForMeeting(db, input.id);
    if (!transcriptId) {
      transcriptId = input.id;
    }

    // Get transcript lines
    let lines = getTranscriptLines(db, transcriptId);

    // Apply limit
    const limit = input.limit || 100;
    if (lines.length > limit) {
      lines = lines.slice(0, limit);
    }

    // Get meeting info
    const meetingInfo = db
      .query(`SELECT name FROM nodes WHERE id = ?`)
      .get(input.id) as { name: string } | null;

    // Format lines for output
    const formattedLines = lines.map((line) => ({
      id: line.id,
      text: line.text,
      speaker: line.speaker,
      startTime: line.startTime ? formatTranscriptTime(line.startTime) : null,
      endTime: line.endTime ? formatTranscriptTime(line.endTime) : null,
      order: line.order,
    }));

    return {
      workspace: workspace.alias,
      meeting: {
        id: input.id,
        name: meetingInfo?.name ?? null,
      },
      lines: formattedLines,
      count: formattedLines.length,
    };
  } finally {
    db.close();
  }
}

/**
 * Search within transcript content
 */
export async function transcriptSearch(
  input: TranscriptSearchInput
): Promise<TranscriptSearchResult> {
  const config = ConfigManager.getInstance().getConfig();
  const workspace = resolveWorkspace(input.workspace, config);

  const db = new Database(workspace.dbPath, { readonly: true });

  try {
    const results = searchTranscripts(db, input.query, {
      limit: input.limit || 20,
    });

    return {
      workspace: workspace.alias,
      query: input.query,
      results: results.map((r) => ({
        lineId: r.lineId,
        lineText: r.lineText,
        speaker: r.speaker,
        meetingId: r.meetingId,
        meetingName: r.meetingName,
      })),
      count: results.length,
    };
  } finally {
    db.close();
  }
}
