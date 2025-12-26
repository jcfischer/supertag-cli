# Transcript Commands

Query and search meeting transcripts from your Tana workspace.

## Overview

Tana stores meeting transcripts as separate nodes linked to meeting entries. The supertag CLI provides dedicated commands to:

- **List** meetings that have transcripts
- **Show** full transcript content with speaker and timing info
- **Search** within transcript text only

By default, transcripts are **excluded from general search and embeddings** to keep results clean. Use these dedicated commands when you specifically want to find spoken content.

## Commands

### List Meetings with Transcripts

```bash
supertag transcript list
```

Shows all meetings that have associated transcripts.

**Default output (TSV for piping):**

```
M9rkJkwuED    Monthly Team Standup    127    2025-12-20
xY7nKpQrSt    Q4 Planning Session     342    2025-12-18
aB3cDeFgHi    Client Review Call      89     2025-12-15
```

**Pretty output (`--pretty`):**

```bash
supertag transcript list --pretty
```

```
🎙️ Meetings with transcripts (3):

  ID            Meeting                         Lines  Date
  ───────────────────────────────────────────────────────────────
  M9rkJkwuED    Monthly Team Standup              127  2025-12-20
  xY7nKpQrSt    Q4 Planning Session               342  2025-12-18
  aB3cDeFgHi    Client Review Call                 89  2025-12-15

💡 Tip: Use 'supertag transcript show <id>' to view transcript
```

**Options:**

| Flag | Description |
|------|-------------|
| `--limit <n>` | Maximum meetings to show (default: 20) |
| `--pretty` | Formatted table output with header |
| `--json` | Output as JSON |
| `-w, --workspace <alias>` | Target specific workspace |

### Show Transcript Content

```bash
supertag transcript show <meeting-id>
```

Display the full transcript for a meeting:

```
Meeting: Monthly Team Standup
────────────────────────────────

[00:00:12] Speaker 1:
  Good morning everyone, let's get started with the standup.

[00:00:18] Speaker 2:
  Sure. Yesterday I finished the API integration and today
  I'm working on the frontend components.

[00:00:35] Speaker 1:
  Great progress. Any blockers?
```

**Options:**

| Flag | Description |
|------|-------------|
| `--limit <n>` | Maximum lines to show (default: 100) |
| `--pretty` | Formatted output with speaker sections |
| `--json` | Output as JSON with full metadata |
| `-w, --workspace <alias>` | Target specific workspace |

**JSON output includes:**
- Line ID
- Speaker name (when available)
- Start/end timestamps
- Full text content

### Search Within Transcripts

```bash
supertag transcript search "quarterly review"
```

Search for text that was spoken in meetings:

```
ID            Meeting                   Speaker      Text
───────────────────────────────────────────────────────────────────────────────
xY7nKpQrSt    Q4 Planning Session       Speaker 2    ...discussed the quarterly review...
M9rkJkwuED    Monthly Team Standup      Speaker 1    ...prep for quarterly review meeting...
```

**Options:**

| Flag | Description |
|------|-------------|
| `--limit <n>` | Maximum results (default: 20) |
| `--json` | Output as JSON |
| `-w, --workspace <alias>` | Target specific workspace |

## Default Transcript Exclusion

Transcripts represent 6-10% of nodes in a typical Tana workspace but contain low-semantic-value spoken language (filler words, fragments, interruptions). By default:

- `supertag search` excludes transcript lines
- `supertag search --semantic` excludes transcript lines
- `supertag embed generate` excludes transcripts

This keeps search results focused on your actual notes and documents.

### Including Transcripts in Embeddings

If you want semantic search to include transcript content:

```bash
supertag embed generate --include-transcripts
```

This will embed all transcript lines, significantly increasing:
- Embedding generation time (~90K additional nodes)
- Storage requirements
- Potential for "noisy" search results

## MCP Tools

Three MCP tools are available for AI assistants:

| Tool | Description |
|------|-------------|
| `tana_transcript_list` | List meetings with transcripts |
| `tana_transcript_show` | Get transcript lines for a meeting |
| `tana_transcript_search` | Search within transcript content |

### Example: Claude Desktop

```
"Find meetings where we discussed the pricing strategy"
→ Uses tana_transcript_search to find relevant discussions

"Show me the transcript from last week's planning meeting"
→ Uses tana_transcript_list to find the meeting
→ Uses tana_transcript_show to display the content
```

## Use Cases

### Find Where Something Was Discussed

```bash
# Search for a topic across all meeting transcripts
supertag transcript search "budget approval"
```

### Review a Past Meeting

```bash
# List recent meetings
supertag transcript list --limit 10

# View specific meeting transcript
supertag transcript show M9rkJkwuED
```

### Export Transcript for Analysis

```bash
# Export full transcript as JSON
supertag transcript show M9rkJkwuED --json > meeting-transcript.json
```

### Check Meeting Coverage

```bash
# How many meetings have transcripts?
supertag transcript list --json | jq length
```

## Technical Details

For information about how Tana stores transcripts internally, see [Tana Transcript Structure](./TANA-TRANSCRIPT-STRUCTURE.md).

Key points:
- Transcripts are linked to meetings via the `SYS_A199` field in metanodes
- Each transcript line has optional speaker (`SYS_A252`) and timing (`SYS_A253`, `SYS_A254`) metadata
- Timestamps use relative format (offset from meeting start)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No transcripts found" | Ensure you have Tana meetings with transcription enabled |
| Empty speaker names | Some transcripts only have generic "Speaker 1" labels |
| Missing timing info | Older transcripts may lack timing metadata |
| Slow queries | Large transcripts (500+ lines) may take 1-2 seconds |
