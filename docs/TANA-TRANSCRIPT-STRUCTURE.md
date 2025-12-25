# Tana Transcript Structure

This document describes how meeting transcripts are stored in Tana's data model.

## Overview

Transcripts are linked to meetings via metanodes and consist of multiple transcript lines, each with speaker and timing metadata.

## Node Types

### Transcript Node
- `_docType`: `"transcript"`
- Contains children array of transcript line IDs
- Named "Transcript"

### Transcript Line Node
- `_docType`: `"transcriptLine"` 
- `name`: The spoken text for that segment
- No direct children (metadata stored in separate metanode)

## Linking Structure

```
Meeting Node (e.g., "Monthly SWITCH Catch-Up")
  └── Metanode (_ownerId → Meeting)
        ├── Tuple [SYS_A13, "meeting"]         // Tag
        ├── Tuple [SYS_A199, transcript_id]    // Transcript link ⭐
        └── Tuple [SYS_A159, ...]              // Unknown flag

Transcript Node (_docType: "transcript")
  ├── TranscriptLine 1 (_docType: "transcriptLine")
  ├── TranscriptLine 2
  └── ...

TranscriptLine Node
  └── Metanode (_ownerId → TranscriptLine)
        ├── Tuple [SYS_A252, "Speaker 1"]      // Speaker name
        ├── Tuple [SYS_A253, "1970-01-01T00:35:58.004Z"]  // Start time
        └── Tuple [SYS_A254, "1970-01-01T00:35:58.484Z"]  // End time
```

## System Fields for Transcripts

| Field | Name | Description |
|-------|------|-------------|
| SYS_A199 | Transcript | Links meeting to transcript node |
| SYS_A252 | Transcript speaker | Speaker identifier (e.g., "Speaker 1") |
| SYS_A253 | Start time | Segment start (relative timestamp) |
| SYS_A254 | End time | Segment end (relative timestamp) |
| SYS_A150 | Speaker | Named speaker from speaker identification |

## Timestamp Format

Transcript timestamps use a special format:
- Base date: `1970-01-01`
- Time portion represents offset from meeting start
- Example: `1970-01-01T00:35:58.004Z` = 35 minutes, 58 seconds into the meeting

## Querying Transcripts

### Find transcript for a meeting
```sql
-- Get transcript ID from meeting's metanode
SELECT v.id as transcript_id
FROM nodes m
JOIN nodes meta ON json_extract(meta.raw_data, '$.props._ownerId') = m.id
JOIN nodes t ON t.id IN (SELECT value FROM json_each(json_extract(meta.raw_data, '$.children')))
JOIN nodes v ON v.id = json_extract(t.raw_data, '$.children[1]')
WHERE m.id = 'MEETING_ID'
  AND json_extract(t.raw_data, '$.children[0]') = 'SYS_A199';
```

### Get transcript lines
```sql
SELECT n.id, n.name as text
FROM nodes t, json_each(json_extract(t.raw_data, '$.children')) c
JOIN nodes n ON n.id = c.value
WHERE t.id = 'TRANSCRIPT_ID';
```

### Get speaker for a transcript line
```sql
SELECT v.name as speaker
FROM nodes line
JOIN nodes meta ON json_extract(meta.raw_data, '$.props._ownerId') = line.id
JOIN nodes t ON t.id IN (SELECT value FROM json_each(json_extract(meta.raw_data, '$.children')))
JOIN nodes v ON v.id = json_extract(t.raw_data, '$.children[1]')
WHERE line.id = 'TRANSCRIPT_LINE_ID'
  AND json_extract(t.raw_data, '$.children[0]') = 'SYS_A252';
```

## Related DocTypes

| DocType | Purpose |
|---------|---------|
| `transcript` | Container for all transcript lines |
| `transcriptLine` | Individual spoken segment |
| `metanode` | Metadata container linked via `_ownerId` |
| `tuple` | Field-value pairs within metanodes |
