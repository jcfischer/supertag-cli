# Webhook Server

HTTP server providing Tana integration endpoints with Tana Paste format responses.

## Quick Start

```bash
# Start server (foreground)
supertag server start

# Start server in background
supertag server start --daemon

# Check status
supertag server status

# Stop server
supertag server stop
```

## Prerequisites

1. Indexed a Tana export: `supertag sync index`
2. For semantic search: `supertag embed generate`

**CORS Support**: The server includes CORS headers to allow browser-based requests from Tana. This enables using webhooks directly from within the Tana application.

## Usage

### Start Server

```bash
supertag server start
```

**Options:**
- `--port <n>` - Port to listen on (default: 3100)
- `--host <host>` - Host to bind to (default: localhost)
- `--daemon` - Run in background

**Example:**
```bash
supertag server start --port 3100 --daemon
```

### Check Status

```bash
supertag server status
```

**Output:**
```
✅ Server is running
   PID: 12345
   Address: http://localhost:3100
   Health: ok
```

### Stop Server

```bash
supertag server stop
```

## API Endpoints

All endpoints return responses in **Tana Paste format** (plain text with bullet points and indentation), ready for direct insertion into Tana.

### 1. Health Check

**Endpoint:** `GET /health`

**Response:** JSON (only endpoint that doesn't return Tana Paste)

```bash
curl http://localhost:3100/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1764514976322
}
```

### 2. Search (Full-Text Search)

**Endpoint:** `POST /search`

**Body:**
```json
{
  "query": "keyword",
  "limit": 10  // optional, default: 10
}
```

**Example:**
```bash
curl -X POST http://localhost:3100/search \
  -H "Content-Type: application/json" \
  -d '{"query": "template", "limit": 3}'
```

**Response (Tana Paste):**
```
- Search Results: template
  - (Template library)
    - Node ID:: VnvlzTzMTA
    - Rank:: -9.97
  - 🌐 Template share
    - Node ID:: 3Li3MJnAPL
    - Rank:: -9.97
  - Weekly Template
    - Node ID:: EYTzDvS6K1Db
    - Rank:: -9.97
```

### 3. Database Statistics

**Endpoint:** `GET /stats`

**Example:**
```bash
curl http://localhost:3100/stats
```

**Response (Tana Paste):**
```
- Database Statistics
  - Total Nodes:: 1,220,449
  - Total Supertags:: 568
  - Total Fields:: 1,502
  - Total References:: 21,943
```

### 4. Top Supertags

**Endpoint:** `POST /tags`

**Body:**
```json
{
  "limit": 10  // optional, default: 10
}
```

**Example:**
```bash
curl -X POST http://localhost:3100/tags \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}'
```

**Response (Tana Paste):**
```
- Top Supertags
  - day
    - Tag ID:: hDwO8FKJfFPP
    - Count:: 125043
  - todo
    - Tag ID:: BSEPoKreAprj
    - Count:: 45678
  - project
    - Tag ID:: N1HH63mKITQD
    - Count:: 23456
```

### 5. Find Nodes

**Endpoint:** `POST /nodes`

**Body:**
```json
{
  "pattern": "Name%",      // optional, SQL LIKE pattern
  "tag": "project",        // optional, filter by supertag
  "limit": 10             // optional, default: 10
}
```

**Example:**
```bash
curl -X POST http://localhost:3100/nodes \
  -H "Content-Type: application/json" \
  -d '{"pattern": "Meeting%", "limit": 5}'
```

**Response (Tana Paste):**
```
- Query Results
  - Meeting Notes - 2025-11-30
    - Node ID:: wLemsA7U0OFg
    - Created:: 11/30/2025
  - Meeting with Team
    - Node ID:: abc123def456
    - Created:: 11/29/2025
```

### 6. Reference Graph

**Endpoint:** `POST /refs`

**Body:**
```json
{
  "nodeId": "wLemsA7U0OFg"
}
```

**Example:**
```bash
curl -X POST http://localhost:3100/refs \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "wLemsA7U0OFg"}'
```

**Response (Tana Paste):**
```
- References for: Meeting Notes
  - Outbound References
    - Project Alpha
      - Type:: inline_ref
    - Task List
      - Type:: inline_ref
  - Inbound References
    - Weekly Review
      - Type:: inline_ref
```

### 7. Semantic Search (Vector/Embedding Search)

**Endpoint:** `POST /semantic-search`

Performs semantic/vector similarity search using embeddings. Finds conceptually similar content even without exact keyword matches.

**Prerequisites:** Embeddings must be configured and generated:
```bash
supertag embed config --provider ollama --model nomic-embed-text
supertag embed generate
```

**Body:**
```json
{
  "query": "productivity thoughts",       // Required: natural language query
  "limit": 10,                           // Optional: max results (default: 20)
  "minSimilarity": 0.5,                  // Optional: 0-1, filter low-quality matches
  "includeContents": false,              // Optional: include full node contents
  "includeAncestor": true,               // Optional: include parent context
  "depth": 0,                            // Optional: child traversal depth (0-3)
  "format": "tana"                       // Optional: "tana" (default) or "json"
}
```

**Example (Tana Paste format):**
```bash
curl -X POST http://localhost:3100/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"query": "productivity tips", "limit": 5}'
```

**Response (Tana Paste):**
```
- Semantic Search: productivity tips
  - Model:: nomic-embed-text
  - Results:: 5 found
  - Personal productivity system
    - Similarity:: 87.3%
    - Node ID:: abc123
    - Tags:: #note, #productivity
    - Context:: Projects → Work → Planning
  - Daily planning routine
    - Similarity:: 82.1%
    - Node ID:: def456
    - Tags:: #todo, #habit
```

**Example (JSON format):**
```bash
curl -X POST http://localhost:3100/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"query": "productivity tips", "limit": 5, "format": "json"}'
```

**Response (JSON):**
```json
{
  "workspace": "default",
  "query": "productivity tips",
  "results": [
    {
      "nodeId": "abc123",
      "name": "Personal productivity system",
      "similarity": 0.873,
      "distance": 0.127,
      "tags": ["note", "productivity"],
      "ancestor": { "id": "xyz789", "name": "Planning", "tags": ["project"] },
      "pathFromAncestor": ["Projects", "Work", "Planning"]
    }
  ],
  "count": 5,
  "model": "nomic-embed-text",
  "dimensions": 768
}
```

**Error Responses:**
- `400 Bad Request`: Missing query parameter
- `503 Service Unavailable`: Embeddings not configured or not generated

### 8. Embedding Statistics

**Endpoint:** `GET /embed-stats`

Returns information about the embedding configuration and statistics.

**Query Parameters:**
- `format`: `tana` (default) or `json`

**Example (Tana Paste format):**
```bash
curl http://localhost:3100/embed-stats
```

**Response (Tana Paste - configured):**
```
- Embedding Statistics
  - Provider:: ollama
  - Model:: nomic-embed-text
  - Dimensions:: 768
  - Embeddings:: 125,000
  - Total Nodes:: 200,000
  - Coverage:: 62.5%
  - Oldest:: 12/1/2025
  - Newest:: 12/12/2025
```

**Response (Tana Paste - not configured):**
```
- Embedding Status
  - Status:: Not Configured
  - Setup:: Run 'supertag embed config --provider ollama --model nomic-embed-text'
```

**Example (JSON format):**
```bash
curl "http://localhost:3100/embed-stats?format=json"
```

**Response (JSON - configured):**
```json
{
  "configured": true,
  "provider": "ollama",
  "model": "nomic-embed-text",
  "dimensions": 768,
  "totalEmbeddings": 125000,
  "totalNodes": 200000,
  "coverage": 62.5,
  "oldest": "2025-12-01T00:00:00.000Z",
  "newest": "2025-12-12T00:00:00.000Z"
}
```

**Response (JSON - not configured):**
```json
{
  "configured": false,
  "message": "Embeddings not configured"
}
```

## Tana Paste Format

All responses (except `/health`) use **Tana Paste format**:

- **Bullet points:** Each line starts with `- ` (dash space)
- **Indentation:** 2 spaces per level
- **Fields:** Use `:: ` separator (e.g., `- Status:: Done`)
- **Hierarchy:** Parent-child relationships via indentation

**Example:**
```
- Parent Node
  - Field Name:: Field Value
  - Child Node 1
    - Nested Field:: Value
  - Child Node 2
```

This format can be directly copied and pasted into Tana, where it will be automatically parsed into structured nodes.

## Integration with Tana

### Using Webhooks in Tana

Tana's **Make API request** command allows you to call the webhook server directly from within Tana. The results are automatically inserted as structured nodes.

#### Setting Up a Semantic Search Command

1. Start the webhook server: `supertag server start --daemon`
2. In Tana, create a new **Command** node
3. Configure the **Make API request** action with these settings:

![Tana Command Configuration](images/tana-command-semantic-search.png)

| Setting | Value |
|---------|-------|
| **URL** | `http://localhost:3100/semantic-search` |
| **API method** | `POST` |
| **Payload** | `{"query": "${sys:context}", "limit": 10, "includeContents": true, "includeAncestor": true, "format": "tana", "workspace": "books"}` |
| **Headers** | `Content-Type: application/json` |
| **Parse result** | `Tana Paste` |
| **Insert output strategy** | `as child` |
| **Avoid using proxy** | `checked` |

#### Payload Parameters Explained

- **`${sys:context}`** - Tana variable that passes the selected text or node content as the search query
- **`limit`** - Maximum number of results to return
- **`includeContents`** - Include full node contents (fields, children) in results
- **`includeAncestor`** - Include parent context for nested matches
- **`format`** - Use `"tana"` for Tana Paste format (required for direct insertion)
- **`workspace`** - Target workspace (use `"main"` for default, or your workspace alias)

#### Using the Command

1. Select text in Tana or position cursor in a node
2. Trigger the command (via command palette or keyboard shortcut)
3. Results appear as child nodes with similarity scores, node IDs, and tags

#### Other Endpoint Examples

**Full-text search command:**
```json
{"query": "${sys:context}", "limit": 10}
```
URL: `http://localhost:3100/search`

**Find tagged nodes:**
```json
{"tag": "project", "limit": 20}
```
URL: `http://localhost:3100/nodes`

## Architecture

```
tana-webhook CLI
    ↓
TanaWebhookServer (Fastify)
    ↓
    ├── TanaQueryEngine (FTS5 database queries)
    ├── TanaPasteConverter (JSON → Tana Paste)
    └── SemanticSearch (vector similarity)
            └── TanaEmbeddingService (resona/LanceDB)
```

**Components:**
- **Fastify:** High-performance HTTP server framework
- **TanaQueryEngine:** SQLite database queries with Drizzle ORM (FTS5 full-text search)
- **TanaPasteConverter:** Bidirectional converter (JSON ↔ Tana Paste)
- **SemanticSearch:** Vector similarity search using resona/LanceDB
- **TanaEmbeddingService:** Wrapper for Ollama embeddings via resona

## Performance

- **Indexing throughput:** 107k nodes/sec
- **FTS search:** < 50ms for typical queries
- **SQL queries:** < 100ms
- **Database size:** 582MB for 1.2M nodes

## Troubleshooting

### Server won't start

**Error:** `Database not found`

**Solution:** Index a Tana export first:
```bash
supertag sync index
```

### Server already running

**Error:** `Server already running (PID: xxx)`

**Solution:** Stop the existing server:
```bash
supertag server stop
```

### Port already in use

**Error:** `EADDRINUSE: address already in use`

**Solution:** Use a different port:
```bash
supertag server start --port 3200
```

## Related Documentation

- [MCP Integration](./mcp.md) - AI tool integration
- [Embeddings](./embeddings.md) - Semantic search setup
- [Launchd Setup](./LAUNCHD-SETUP.md) - Auto-start configuration
