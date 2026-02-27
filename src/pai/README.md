# PAI Memory Integration — Hook Interface

## Overview

This module provides the integration layer between pai-seed's learning lifecycle and Tana's knowledge graph. The primary interface is CLI commands that pai-seed calls as subprocesses.

## Session Start Hook

When a PAI session starts, load relevant context from Tana:

```bash
supertag pai context <topic> --format json --max-tokens 2000
```

**Response format (JSON):**

```json
{
  "learnings": [
    {
      "content": "User prefers German for internal communications",
      "type": "pattern",
      "confirmedAt": "2026-02-10T15:00:00Z",
      "freshness": "fresh",
      "linkedTo": ["Jens-Christian Fischer"]
    }
  ],
  "relatedNodes": [
    {
      "name": "CTF Platform",
      "type": "project",
      "lastModified": "2026-02-25T10:00:00Z"
    }
  ],
  "tokenCount": 450
}
```

## Post-Confirmation Hook

When a proposal is accepted, sync the learning to Tana:

```bash
supertag pai sync --seed-path ~/.pai/seed.json
```

**Response format (JSON with --format json):**

```json
{
  "total": 1,
  "created": 1,
  "updated": 0,
  "skipped": 0,
  "failed": 0,
  "entries": [
    {
      "seedId": "pat_abc123",
      "tanaNodeId": "xyz789",
      "action": "created",
      "entityLinks": [
        { "entityName": "Jens-Christian", "tanaNodeId": "person123", "tagType": "person", "confidence": 0.95 }
      ]
    }
  ],
  "lastSync": "2026-02-22T10:00:00Z"
}
```

## Error Response Format

All commands return structured errors:

```json
{
  "code": "CONFIG_NOT_FOUND",
  "message": "seed.json not found at ~/.pai/seed.json",
  "suggestion": "Ensure pai-seed is installed and has created seed.json",
  "details": { "path": "~/.pai/seed.json" }
}
```

## Configuration Requirements

1. **Tana workspace configured**: `supertag workspace add <nodeId> --alias main`
2. **Database synced**: `supertag sync index` (for entity resolution)
3. **seed.json exists**: `~/.pai/seed.json` (created by pai-seed)
4. **For write operations**: Tana Desktop running OR Input API configured

## Graceful Degradation

| Tana Status | Sync | Context | Freshness |
|-------------|------|---------|-----------|
| Desktop running | Full sync with entity linking | Graph-enriched context | Graph-aware scoring |
| Desktop offline, DB exists | Error (needs write API) | Seed.json + SQLite search | Timestamp-only scoring |
| No database | Error | Seed.json-only | Timestamp-only scoring |
| No seed.json | Error | Error | Error |

## MCP Tools

For AI agents, the same functionality is available as MCP tools:

- `tana_pai_sync` — Sync learnings to Tana
- `tana_pai_context` — Retrieve learning context for a topic
- `tana_pai_freshness` — Check learning freshness
