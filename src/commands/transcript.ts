/**
 * Transcript Commands
 *
 * Provides CLI access to meeting transcripts stored in Tana.
 *
 * Subcommands:
 *   list   - List meetings with transcripts
 *   show   - Show transcript content for a meeting
 *   search - Search within transcript content
 *
 * Usage:
 *   supertag transcript list                     # List meetings with transcripts
 *   supertag transcript show <meeting-id>        # Show transcript lines
 *   supertag transcript search <query>           # Search in transcripts
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import {
  getMeetingsWithTranscripts,
  getTranscriptForMeeting,
  getTranscriptLines,
  searchTranscripts,
  formatTranscriptTime,
  parseInlineRefs,
  type TranscriptSummary,
  type TranscriptLine,
  type TranscriptSearchResult,
} from "../db/transcript";
import {
  resolveDbPath,
  checkDb,
  addStandardOptions,
  formatJsonOutput,
} from "./helpers";
import {
  tsv,
  EMOJI,
  header,
  formatDateISO,
  tip,
  table,
} from "../utils/format";
import { resolveOutputOptions } from "../utils/output-options";
import type { StandardOptions } from "../types";

interface TranscriptOptions extends StandardOptions {
  // Additional options can be added here
}

/**
 * Create the transcript command with subcommands
 */
export function createTranscriptCommand(): Command {
  const transcript = new Command("transcript");

  transcript.description("Access and search meeting transcripts");

  // Add list subcommand
  transcript.addCommand(createListCommand());

  // Add show subcommand
  transcript.addCommand(createShowCommand());

  // Add search subcommand
  transcript.addCommand(createSearchCommand());

  return transcript;
}

/**
 * Create the list subcommand
 */
function createListCommand(): Command {
  const list = new Command("list");

  list.description("List meetings with transcripts");

  addStandardOptions(list, { defaultLimit: "20" });

  list.action(async (options: TranscriptOptions) => {
    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    const outputOpts = resolveOutputOptions(options);
    const limit = options.limit ? parseInt(String(options.limit)) : 20;

    try {
      const meetings = getMeetingsWithTranscripts(db, { limit });

      if (meetings.length === 0) {
        if (options.json) {
          console.log("[]");
        } else {
          console.log("No meetings with transcripts found.");
          console.log(tip("Use 'supertag sync' to ensure your data is up to date"));
        }
        return;
      }

      if (options.json) {
        console.log(formatJsonOutput(meetings));
      } else if (outputOpts.pretty) {
        console.log(`\n${header(EMOJI.transcribe, `Meetings with transcripts (${meetings.length})`)}:\n`);

        const rows = meetings.map((meeting) => {
          const dateStr = meeting.created
            ? outputOpts.humanDates
              ? new Date(meeting.created).toLocaleDateString()
              : formatDateISO(meeting.created)
            : "";
          return [meeting.meetingId, meeting.meetingName, String(meeting.lineCount), dateStr];
        });

        console.log(table(["ID", "Meeting", "Lines", "Date"], rows, { align: ["left", "left", "right", "left"] }));

        console.log(tip("Use 'supertag transcript show <id>' to view transcript"));
      } else {
        // Unix mode: TSV output
        // Format: meeting_id\tmeeting_name\tline_count\tcreated
        for (const meeting of meetings) {
          const dateStr = meeting.created ? formatDateISO(meeting.created) : "";
          console.log(tsv(meeting.meetingId, meeting.meetingName, String(meeting.lineCount), dateStr));
        }
      }
    } finally {
      db.close();
    }
  });

  return list;
}

/**
 * Create the show subcommand
 */
function createShowCommand(): Command {
  const show = new Command("show");

  show
    .description("Show transcript content for a meeting")
    .argument("<id>", "Meeting or transcript node ID");

  addStandardOptions(show, { defaultLimit: "100" });

  show.action(async (id: string, options: TranscriptOptions) => {
    if (!id) {
      console.error("❌ Meeting or transcript ID is required");
      console.error("   Use: supertag transcript show <id>");
      process.exit(1);
    }

    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    const outputOpts = resolveOutputOptions(options);
    const limit = options.limit ? parseInt(String(options.limit)) : 100;

    try {
      // First, try to get transcript for meeting ID
      let transcriptId = getTranscriptForMeeting(db, id);

      // If not found, assume ID is a transcript ID
      if (!transcriptId) {
        transcriptId = id;
      }

      // Get transcript lines
      let lines = getTranscriptLines(db, transcriptId);

      if (lines.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ meeting: id, lines: [] }));
        } else {
          console.error(`❌ No transcript found for ID: ${id}`);
          console.error(tip("Use 'supertag transcript list' to see available transcripts"));
        }
        return;
      }

      // Apply limit
      if (limit && lines.length > limit) {
        lines = lines.slice(0, limit);
      }

      // Get meeting info
      const meetingName = db
        .query(`SELECT name FROM nodes WHERE id = ?`)
        .get(id) as { name: string } | null;

      const parsedName = parseInlineRefs(meetingName?.name ?? "") || "(unknown)";

      if (options.json) {
        console.log(formatJsonOutput({
          meeting: {
            id,
            name: parsedName,
          },
          lines: lines.map((line) => ({
            id: line.id,
            text: line.text,
            speaker: line.speaker,
            startTime: line.startTime ? formatTranscriptTime(line.startTime) : null,
            endTime: line.endTime ? formatTranscriptTime(line.endTime) : null,
            order: line.order,
          })),
        }));
      } else if (outputOpts.pretty) {
        console.log(`\n${header(EMOJI.transcribe, parsedName)}:\n`);

        let currentSpeaker: string | null = null;

        for (const line of lines) {
          // Show speaker change
          if (line.speaker !== currentSpeaker) {
            currentSpeaker = line.speaker;
            console.log(`\n🎤 ${currentSpeaker ?? "Unknown Speaker"}:`);
          }

          // Show timestamp and text
          const timestamp = line.startTime ? `[${formatTranscriptTime(line.startTime)}]` : "";
          console.log(`  ${timestamp} ${line.text}`);
        }

        if (lines.length < (await getTranscriptLines(db, transcriptId)).length) {
          console.log(tip(`Showing ${lines.length} lines. Use --limit to see more.`));
        }
      } else {
        // Unix mode: TSV output
        // Format: order\tspeaker\tstart_time\ttext
        for (const line of lines) {
          const timestamp = line.startTime ? formatTranscriptTime(line.startTime) : "";
          console.log(tsv(String(line.order), line.speaker ?? "", timestamp, line.text));
        }
      }
    } finally {
      db.close();
    }
  });

  return show;
}

/**
 * Create the search subcommand
 */
function createSearchCommand(): Command {
  const search = new Command("search");

  search
    .description("Search within transcript content")
    .argument("<query>", "Search query");

  addStandardOptions(search, { defaultLimit: "20" });

  search.action(async (query: string, options: TranscriptOptions) => {
    if (!query) {
      console.error("❌ Search query is required");
      console.error("   Use: supertag transcript search <query>");
      process.exit(1);
    }

    const dbPath = resolveDbPath(options);
    if (!checkDb(dbPath, options.workspace)) {
      process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    const outputOpts = resolveOutputOptions(options);
    const limit = options.limit ? parseInt(String(options.limit)) : 20;

    try {
      const results = searchTranscripts(db, query, { limit });

      if (results.length === 0) {
        if (options.json) {
          console.log("[]");
        } else {
          console.log(`No transcript lines found matching "${query}"`);
        }
        return;
      }

      if (options.json) {
        console.log(formatJsonOutput(results));
      } else if (outputOpts.pretty) {
        console.log(`\n${header(EMOJI.search, `Transcript search: "${query}" (${results.length} results)`)}:\n`);

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const speakerInfo = result.speaker ? ` (${result.speaker})` : "";
          const meetingInfo = result.meetingName ? ` — from "${result.meetingName}"` : "";

          console.log(`${i + 1}. "${result.lineText}"${speakerInfo}${meetingInfo}`);
          console.log(`   ID: ${result.lineId}`);
          console.log();
        }
      } else {
        // Unix mode: TSV output
        // Format: line_id\tline_text\tspeaker\tmeeting_name
        for (const result of results) {
          console.log(tsv(result.lineId, result.lineText, result.speaker ?? "", result.meetingName ?? ""));
        }
      }
    } finally {
      db.close();
    }
  });

  return search;
}
