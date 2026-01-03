---
id: "072"
feature: "Streaming & Pagination"
status: "draft"
created: "2026-01-01"
---

# Specification: Streaming & Pagination

## Overview

Add streaming support for large result sets and cursor-based pagination for stable iteration. Enables handling of datasets larger than memory and consistent paging through changing data.

## User Scenarios

### Scenario 1: Stream Large Results

**As an** AI agent processing many nodes
**I want to** receive results as a stream
**So that** I can process items as they arrive without waiting for all

**Acceptance Criteria:**
- [ ] `stream: true` parameter enables streaming
- [ ] Results arrive as JSONL (one JSON object per line)
- [ ] Can process items before full result is ready
- [ ] Memory usage stays constant regardless of result size

### Scenario 2: Stable Pagination

**As an** AI agent iterating through results
**I want to** use cursor-based pagination
**So that** new/deleted items don't cause duplicates or misses

**Acceptance Criteria:**
- [ ] `cursor` parameter resumes from exact position
- [ ] Works correctly even if data changes between pages
- [ ] No duplicate items across pages
- [ ] No skipped items across pages

### Scenario 3: Parallel Page Processing

**As an** AI agent processing large datasets
**I want to** fetch pages in parallel
**So that** I can process faster with multiple workers

**Acceptance Criteria:**
- [ ] Can request specific page ranges
- [ ] Pages are independent and can be processed concurrently
- [ ] Total count available before fetching all pages
- [ ] Consistent partitioning across pages

### Scenario 4: CLI Progress Feedback

**As a** CLI user running long queries
**I want to** see progress as results stream
**So that** I know the query is working

**Acceptance Criteria:**
- [ ] `--progress` shows items fetched/total
- [ ] Works with `--stream` flag
- [ ] Doesn't interfere with piped output
- [ ] Shows ETA for completion

## Functional Requirements

### FR-1: Streaming Support

Enable streaming for large result sets:

```typescript
// MCP - streaming response
tana_search({
  query: "project",
  stream: true,
  limit: 10000
})
// Returns: AsyncIterable<Node> or JSONL stream

// CLI
supertag search project --stream --limit 10000
# Outputs one JSON object per line as results arrive
```

**Validation:** Results stream without loading all into memory.

### FR-2: JSONL Output Format

Streaming uses JSONL format:

```jsonl
{"id":"node1","name":"Project A","type":"project"}
{"id":"node2","name":"Project B","type":"project"}
{"id":"node3","name":"Project C","type":"project"}
```

With metadata at end:
```jsonl
{"id":"node1","name":"Project A"}
{"id":"node2","name":"Project B"}
{"_meta":{"total":2,"cursor":"abc123","hasMore":false}}
```

**Validation:** Each line is valid JSON, metadata is clearly marked.

### FR-3: Cursor-Based Pagination

Stable pagination using cursors:

```typescript
// First page
const page1 = await tana_search({
  query: "project",
  limit: 50
});
// page1.cursor = "eyJpZCI6Im5vZGU1MCIsInNvcnQiOjE3MzU2ODk2MDB9"
// page1.hasMore = true

// Next page
const page2 = await tana_search({
  query: "project",
  limit: 50,
  cursor: page1.cursor
});
```

**Cursor contains:**
- Last item's sort key (encoded)
- Last item's ID (for ties)
- Query fingerprint (to detect query changes)

**Validation:** Cursor resumes exactly where previous page ended.

### FR-4: Pagination Response

Paginated responses include navigation info:

```typescript
{
  items: [...],
  pagination: {
    cursor: "abc123...",                 // Cursor for next page
    hasMore: true,                       // More pages available
    total: 1250,                         // Total items (if known)
    pageSize: 50,                        // Items in this page
    pageNumber: 3                        // Current page (1-based)
  }
}
```

**Validation:** All pagination info available.

### FR-5: Offset-Based Pagination (Legacy)

Support offset-based pagination for simple cases:

```typescript
// Offset-based (simpler but less stable)
tana_search({
  query: "project",
  limit: 50,
  offset: 100                            // Skip first 100 items
})
```

**Validation:** Offset works but cursor is recommended.

### FR-6: Total Count

Efficiently get total count:

```typescript
// Count only (no items)
const count = await tana_search({
  query: "project",
  countOnly: true
});
// Returns: { total: 1250 }

// Or with first page
const page1 = await tana_search({
  query: "project",
  limit: 50,
  includeTotal: true
});
// page1.pagination.total = 1250
```

**Validation:** Count available without fetching all items.

### FR-7: Page Ranges for Parallel Processing

Request specific page ranges:

```typescript
// Partition dataset into 4 chunks
const partitions = await tana_search({
  query: "project",
  partitions: 4
});
// Returns: [
//   { cursor: "start", endCursor: "abc123", estimatedCount: 312 },
//   { cursor: "abc123", endCursor: "def456", estimatedCount: 313 },
//   { cursor: "def456", endCursor: "ghi789", estimatedCount: 312 },
//   { cursor: "ghi789", endCursor: "end", estimatedCount: 313 }
// ]

// Then fetch each partition in parallel
await Promise.all(partitions.map(p =>
  tana_search({ query: "project", cursor: p.cursor, endCursor: p.endCursor })
));
```

**Validation:** Partitions enable parallel processing.

### FR-8: CLI Progress Display

Show progress during streaming:

```bash
$ supertag search project --stream --progress
Streaming results...
[=====>                    ] 250/1250 (20%) ETA: 4s
```

Progress goes to stderr, results to stdout:
```bash
$ supertag search project --stream --progress > results.jsonl
[=====>                    ] 250/1250 (20%) ETA: 4s
```

**Validation:** Progress visible, doesn't interfere with output.

### FR-9: Backpressure Handling

Handle slow consumers:

**Validation:**
- Pause fetching if consumer is slow
- Buffer reasonable amount (configurable)
- Don't OOM on slow consumers
- Resume when consumer catches up

## Non-Functional Requirements

- **Memory:** Constant memory for streaming (< 50MB for any result size)
- **Latency:** First result in < 200ms for streaming
- **Throughput:** Stream 1000 items/second minimum
- **Consistency:** Cursor valid for at least 1 hour

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| StreamConfig | Streaming settings | `enabled`, `format`, `bufferSize` |
| Cursor | Pagination state | `encodedState`, `queryHash` |
| PageInfo | Pagination metadata | `cursor`, `hasMore`, `total` |
| Partition | Parallel chunk | `startCursor`, `endCursor`, `count` |

## Success Criteria

- [ ] 100K results streamed without memory issues
- [ ] Cursor pagination stable across data changes
- [ ] Parallel partitioning enables 4x+ speedup
- [ ] Progress display works with piping

## Assumptions

- Database supports efficient cursor-based queries
- Sort order is stable (deterministic tie-breaking)
- Cursors don't need to survive server restarts

## [NEEDS CLARIFICATION]

- How long should cursors remain valid?
- Should we support resumable streams (reconnect after disconnect)?
- How to handle cursor invalidation (schema/query change)?

## Out of Scope

- WebSocket streaming
- Real-time subscriptions
- Infinite scroll UI support
- Cursor encryption/signing
- Cross-request transaction isolation
