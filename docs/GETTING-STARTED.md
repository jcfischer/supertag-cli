# Getting Started with Supertag CLI

**Your Tana knowledge base, at your fingertips.**

Supertag CLI brings the power of your Tana workspace to the command line. Search your notes in milliseconds, create content from scripts, and integrate with AI assistants like Claude—all while keeping your data 100% private and local.

---

## What You'll Learn

This guide walks you through everything from installation to advanced integrations:

1. [Installation & Setup](#1-installation--setup) — Get up and running in 2 minutes
2. [Full-Text Search](#2-full-text-search) — Lightning-fast keyword search
3. [Exploring Supertags](#3-exploring-supertags) — Query nodes by tag
4. [Semantic Search](#4-semantic-search) — Find by meaning, not just keywords
5. [Creating Content](#5-creating-content) — Add todos, meetings, and notes
6. [AI Integration (MCP)](#6-ai-integration-mcp) — Connect Claude and other assistants
7. [Multiple Workspaces](#7-multiple-workspaces) — Manage work and personal spaces
8. [HTTP API](#8-http-api) — Build custom integrations

---

## 1. Installation & Setup

Get Supertag CLI running in under 2 minutes. No runtime dependencies—just download, extract, and go.

### Download and Extract

Download the appropriate binary for your platform from the releases page, then extract it:

![Terminal: Extract and setup](images/01-install.svg)

```bash
# Extract the downloaded archive
unzip supertag-cli-v0.13.0-macos-arm64.zip
cd supertag-cli-macos-arm64

# macOS only: Remove quarantine attribute
xattr -d com.apple.quarantine ./supertag ./supertag-export ./supertag-mcp
```

### Login to Tana

Authenticate with your Tana account through the browser:

![Terminal: Login to Tana](images/02-login.svg)

```bash
./supertag-export login
```

A browser window opens—sign in normally, then close the browser. Your session is saved locally.

### Discover Your Workspaces

Supertag automatically finds all your Tana workspaces:

![Terminal: Discover workspaces](images/03-discover.svg)

```bash
./supertag-export discover
```

Your main workspace is added by default. You'll see workspace names and node counts.

### Export and Index Your Data

Export your Tana data and create a local search index:

![Terminal: Export and index](images/04-export-index.svg)

```bash
# Export data from Tana (takes a few minutes for large workspaces)
./supertag-export run

# Index for fast local search (~100k nodes/second)
./supertag sync index
```

**That's it!** You're ready to search.

---

## 2. Full-Text Search

Search your entire Tana workspace in milliseconds using SQLite FTS5.

### Basic Search

Find any term across all your notes:

![Terminal: Basic search](images/05-search-basic.svg)

```bash
supertag search "project planning"
```

Results show the matching node and its tagged ancestor for context—so you know if that note is from a meeting, project, or standalone idea.

### Search with Full Details

Use `--show` to see complete node content including all fields:

![Terminal: Search with details](images/06-search-show.svg)

```bash
supertag search "todo" --tag todo --show --limit 3
```

### JSON Output for Scripting

Perfect for automation and building your own tools:

```bash
supertag search "API" --limit 3 --json | jq '.[0]'
```

### Speed Test

Even broad searches complete in under 50 milliseconds:

```bash
time supertag search "the"
# real    0m0.042s
```

---

## 3. Exploring Supertags

Query all nodes with a specific supertag instantly.

### Discover Your Tags

See what supertags you've created and how often they're used:

![Terminal: List supertags](images/07-tags-top.svg)

```bash
supertag tags top --limit 10
```

### Find All Tagged Items

Query by any supertag—meetings, todos, contacts, projects:

![Terminal: Query by tag](images/08-tagged-query.svg)

```bash
supertag search "" --tag meeting --limit 5
```

### Explore Node Trees

Use depth traversal to see a node's children:

```bash
supertag nodes show <node-id> --depth 2
```

This is perfect for exploring projects with nested tasks or meetings with action items.

---

## 4. Semantic Search

Find content by meaning, not just keywords. Semantic search discovers conceptually related notes even when the exact words don't match.

### Prerequisites

You'll need Ollama for local embeddings:

```bash
brew install ollama
ollama pull bge-m3
```

### Configure Embeddings

Set up the embedding model:

![Terminal: Configure embeddings](images/09-embed-config.svg)

```bash
supertag embed config --model bge-m3
supertag embed config --show
```

### Generate Embeddings

Process your workspace (smart filtering reduces workload by ~47%):

```bash
supertag embed generate --verbose
```

### Search by Meaning

Now compare keyword vs. semantic search:

![Terminal: Semantic search](images/10-semantic-search.svg)

```bash
# Keyword search - exact matches only
supertag search "productivity tips"

# Semantic search - finds related concepts
supertag search "productivity tips" --semantic
```

Semantic search finds notes about "time management" and "getting things done" even without those exact keywords.

---

## 5. Creating Content

Create todos, meetings, notes—any supertag—directly from the command line or scripts.

### Setup

Configure your Tana API token and sync your schema:

```bash
supertag config --token YOUR_TOKEN
supertag schema sync
```

### Create a Todo

![Terminal: Create todo](images/11-create-todo.svg)

```bash
supertag create todo "Review pull request #42" --status active
```

The todo appears instantly in Tana.

### Create a Meeting

```bash
supertag create meeting "Team standup" --date 2025-12-23
```

### Explore Available Fields

See what fields any supertag supports:

```bash
supertag schema show project
```

### Multiple Tags

Apply several supertags at once:

```bash
supertag create video,towatch "Machine Learning Tutorial" --url "https://..."
```

---

## 6. AI Integration (MCP)

MCP (Model Context Protocol) is like USB-C for AI tools—it lets Claude, ChatGPT, Cursor, and other assistants access your Tana data directly.

### Configure Claude

Add Supertag to your Claude config:

![Terminal: MCP config](images/12-mcp-config.svg)

```json
{
  "mcpServers": {
    "supertag": {
      "command": "/path/to/supertag-mcp"
    }
  }
}
```

No server to run—it starts automatically as a subprocess.

### Natural Language Queries

Now ask Claude questions about your Tana data:

- **"Search my Tana for notes about API authentication"** → Uses `tana_search`
- **"Find my recent todos in Tana"** → Uses `tana_tagged`
- **"Find notes similar to 'knowledge management'"** → Uses `tana_semantic_search`

### Create Content via Chat

- **"Create a new todo in Tana: Review the quarterly report"** → Uses `tana_create`

Your data stays 100% private—all queries run against your local database.

**Compatible with:** Claude Desktop, Claude Code, Cursor, ChatGPT Desktop, and any MCP-compatible assistant.

---

## 7. Multiple Workspaces

Manage personal, work, and archived workspaces from a single CLI.

### Discover All Workspaces

![Terminal: Discover workspaces](images/13-workspace-discover.svg)

```bash
supertag-export discover
```

### Add Workspaces

Add by ID with a friendly alias:

```bash
supertag workspace add ABC123XYZ --alias work

# Or add all discovered workspaces at once
supertag-export discover --add
```

### Query Specific Workspaces

Switch workspaces with the `-w` flag:

```bash
# Search in work workspace
supertag search "quarterly report" -w work

# Default goes to your main workspace
supertag search "personal notes"
```

### Batch Operations

Export and index all workspaces at once:

```bash
supertag-export run --all
supertag sync index --all
```

Each workspace has its own database, keeping everything organized.

---

## 8. HTTP API

The webhook server provides an HTTP API for custom integrations with Shortcuts, Raycast, Alfred, or any tool that speaks HTTP.

### Start the Server

![Terminal: Start server](images/14-server-start.svg)

```bash
supertag server start --port 3100
supertag server status
```

### Search Endpoint

Returns results in Tana Paste format—ready to paste into Tana:

```bash
curl -X POST http://localhost:3100/search \
  -H "Content-Type: application/json" \
  -d '{"query": "project planning", "limit": 5}'
```

### Semantic Search Endpoint

Returns a Tana table with similarity scores:

```bash
curl -X POST http://localhost:3100/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"query": "knowledge management", "limit": 5}'
```

### Statistics

Get database stats—node counts, supertag counts, last sync time:

```bash
curl http://localhost:3100/stats
```

### Daemon Mode

Run as a background service for always-on availability:

```bash
supertag server start --port 3100 --daemon
supertag server stop
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Login | `supertag-export login` |
| Discover workspaces | `supertag-export discover` |
| Export data | `supertag-export run` |
| Index data | `supertag sync index` |
| Search | `supertag search "query"` |
| Semantic search | `supertag search "query" --semantic` |
| Query by tag | `supertag search "" --tag meeting` |
| List supertags | `supertag tags top` |
| Create node | `supertag create todo "Task name"` |
| Start HTTP API | `supertag server start --port 3100` |

---

## Next Steps

- **Explore the MCP tools** — Type `/mcp` in Claude Code to see available Tana tools
- **Build integrations** — Use the HTTP API with Shortcuts, Raycast, or your own scripts
- **Set up auto-sync** — Schedule regular exports with cron or launchd
- **Check the demos** — Each numbered file in this directory shows a specific feature in detail

---

*Your Tana knowledge base, searchable in milliseconds, accessible from anywhere.*
