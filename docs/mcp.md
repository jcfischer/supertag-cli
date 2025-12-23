# MCP - AI Tool Integration

The MCP (Model Context Protocol) server enables Tana integration with AI tools like ChatGPT Desktop, Cursor, VS Code Copilot, Claude Code, and other MCP-compatible applications.

## What is MCP?

MCP is the emerging industry standard for AI-tool integration, backed by Anthropic, OpenAI, Google, and Microsoft. Think of it as "USB-C for AI" - a universal standard that lets any AI assistant access your Tana data.

The `supertag-mcp` binary runs locally on your machine as a subprocess - no server setup, no cloud hosting, no network exposure needed.

## Available Tools

| Tool | Description | Example Query |
|------|-------------|---------------|
| `tana_search` | Full-text search across workspace | "Search my Tana for project notes" |
| `tana_semantic_search` | Vector similarity search | "Find notes about knowledge management" |
| `tana_tagged` | Find nodes by supertag | "Find all my todos" |
| `tana_stats` | Database statistics | "How many nodes in my Tana?" |
| `tana_supertags` | List all supertags | "What supertags do I have?" |
| `tana_supertag_info` | Query supertag inheritance and fields | "What fields does the meeting tag have?" |
| `tana_node` | Get node contents with depth | "Show node abc123 with children" |
| `tana_create` | Create new nodes with references | "Create a todo linked to node abc123" |
| `tana_sync` | Trigger reindex or status | "Reindex my Tana database" |

## Prerequisites

1. **Indexed database**: `supertag sync index`
2. **API token** (for `tana_create`): `supertag config --token YOUR_TOKEN`
3. **Schema registry** (for `tana_create`): `supertag schema sync`

---

## Setup Guides

### Claude Desktop

**Config locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tana": {
      "command": "/path/to/supertag-mcp",
      "env": { "TANA_WORKSPACE": "main" }
    }
  }
}
```

### Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "tana": {
      "command": "/path/to/supertag-mcp",
      "env": { "TANA_WORKSPACE": "main" }
    }
  }
}
```

### ChatGPT Desktop

**Config locations:**
- **macOS**: `~/Library/Application Support/ChatGPT/chatgpt_config.json`
- **Windows**: `%APPDATA%\ChatGPT\chatgpt_config.json`

```json
{
  "mcpServers": {
    "tana": {
      "command": "/path/to/supertag-mcp"
    }
  }
}
```

### Cursor IDE

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tana": {
      "command": "/path/to/supertag-mcp"
    }
  }
}
```

Then: Cursor Settings → Features → MCP → Enable

### VS Code + Copilot

Add to `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "tana": {
      "command": "/path/to/supertag-mcp"
    }
  }
}
```

### Windsurf

Add to Settings → MCP Servers:

```json
{
  "tana": {
    "command": "/path/to/supertag-mcp"
  }
}
```

### Windows Configuration

Use full path with double backslashes:

```json
{
  "mcpServers": {
    "tana": {
      "command": "C:\\path\\to\\supertag-mcp.exe"
    }
  }
}
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TANA_WORKSPACE` | Workspace alias | Default workspace |
| `DEBUG` | Enable debug logging | `false` |

---

## Testing MCP Setup

```bash
npx @modelcontextprotocol/inspector /path/to/supertag-mcp
```

This opens a web UI to test tools interactively.

---

## How It Works

- Runs locally as subprocess (no network server)
- Uses stdin/stdout JSON-RPC (no ports)
- Reads local SQLite database
- Write ops use your Tana API token
- 100% private - all data stays on your machine

---

## Creating Nodes with References

The Tana Input API does NOT support inline reference syntax (`[[text^nodeId]]`) in node names. If you include such syntax, it will appear as plain text, not as a clickable link.

**To create nodes with references**, use the `children` parameter with the node ID:

```json
{
  "supertag": "todo",
  "name": "Follow up on feedback form",
  "children": [{"name": "NetSec Feedback Form", "id": "dvpAO46vtnrx"}]
}
```

This creates a todo with a child reference that links to the existing node.

---

## Local LLMs (Ollama)

You can use Supertag MCP tools with local LLMs running in Ollama for completely offline, private AI access to your Tana data.

### Prerequisites

1. [Ollama](https://ollama.com) installed and running
2. A tool-calling capable model (e.g., `qwen2.5:7b`, `llama3.1`, `mistral`)
3. [mcphost](https://github.com/mark3labs/mcphost) - MCP client for Ollama

### Step 1: Install mcphost

```bash
# macOS
brew install mcphost

# Or build from source
go install github.com/mark3labs/mcphost@latest
```

### Step 2: Configure MCP servers

Create `~/.mcp.json`:

```json
{
  "mcpServers": {
    "supertag": {
      "command": "/path/to/supertag-mcp",
      "args": []
    },
    "datetime": {
      "command": "/path/to/datetime-mcp",
      "args": []
    }
  }
}
```

The `datetime` MCP provides `get_current_datetime` and `get_date_info` tools - essential for local LLMs that lack real-time awareness.

### Step 3: Pull a tool-calling model

```bash
ollama pull qwen2.5:7b
```

### Step 4: Run mcphost

**Interactive mode:**
```bash
mcphost --quiet -m ollama:qwen2.5:7b
```

**Single prompt mode:**
```bash
mcphost --quiet -m ollama:qwen2.5:7b -p "List the top 5 supertags in workspace 'main'"
```

> **Tip:** Use `--quiet` to reduce visual noise from MCP server initialization.

### Supported Models

| Model | Tool Execution | Date Awareness | Notes |
|-------|----------------|----------------|-------|
| **Claude Code** | Excellent | Real-time | Best option |
| `qwen2.5:7b` | Good | Training cutoff | Needs explicit date |
| `llama3.1:8b` | Good | Training cutoff | Needs explicit date |
| `qwen2.5:14b` | Failed | N/A | Outputs as text |
| `mistral:7b` | Failed | N/A | Doesn't execute |

**Key Finding:** Local LLMs lack date awareness - always provide explicit dates or use the `datetime` MCP's `get_current_datetime` first.

**Recommendation:** Use Claude Code for date-aware queries, or `qwen2.5:7b` with explicit dates.

---

## Example AI Queries

- "Search my Tana for notes about authentication"
- "Find all my todos in Tana"
- "What supertags do I have?"
- "Show me the node with ID abc123"
- "Create a new todo called 'Review pull request'"
- "Reindex my Tana database"

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Tools not appearing | Verify path is absolute, restart app |
| Database not found | Run `supertag sync index` |
| Schema empty | Run `supertag schema sync` |
| Debug mode | Add `"DEBUG": "true"` to env |
