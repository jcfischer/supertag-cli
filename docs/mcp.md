# MCP - AI Tool Integration

The MCP (Model Context Protocol) server enables Tana integration with AI tools like ChatGPT Desktop, Cursor, VS Code Copilot, Claude Code, and other MCP-compatible applications.

## What is MCP?

MCP is the emerging industry standard for AI-tool integration, backed by Anthropic, OpenAI, Google, and Microsoft. Think of it as "USB-C for AI" - a universal standard that lets any AI assistant access your Tana data.

The `supertag-mcp` binary runs locally on your machine as a subprocess - no server setup, no cloud hosting, no network exposure needed.

## Available Tools

### Discovery Tools (Start Here)

| Tool | Description | Example Query |
|------|-------------|---------------|
| `tana_capabilities` | Lightweight overview of all tools | "What can this Tana MCP do?" |
| `tana_tool_schema` | Get full schema for a specific tool | Load parameters for `tana_search` |

### Query Tools

| Tool | Description | Example Query |
|------|-------------|---------------|
| `tana_search` | Full-text search across workspace | "Search my Tana for project notes" |
| `tana_semantic_search` | Vector similarity search | "Find notes about knowledge management" |
| `tana_tagged` | Find nodes by supertag | "Find all my todos" |
| `tana_field_values` | Query text-based field values | "Get values for 'Summary' field" |

### Explore Tools

| Tool | Description | Example Query |
|------|-------------|---------------|
| `tana_node` | Get node contents with depth | "Show node abc123 with children" |
| `tana_stats` | Database statistics | "How many nodes in my Tana?" |
| `tana_supertags` | List all supertags | "What supertags do I have?" |
| `tana_supertag_info` | Query supertag inheritance and fields | "What fields does the meeting tag have?" |

### Transcript Tools

| Tool | Description | Example Query |
|------|-------------|---------------|
| `tana_transcript_list` | List meetings with transcripts | "Which meetings have transcripts?" |
| `tana_transcript_show` | Get transcript for a meeting | "Show transcript from last standup" |
| `tana_transcript_search` | Search within transcripts | "Find where we discussed pricing" |

### Mutate Tools

| Tool | Description | Example Query |
|------|-------------|---------------|
| `tana_create` | Create new nodes with references | "Create a todo linked to node abc123" |

### System Tools

| Tool | Description | Example Query |
|------|-------------|---------------|
| `tana_sync` | Trigger reindex or status | "Reindex my Tana database" |
| `tana_cache_clear` | Clear workspace cache | "Refresh workspace configuration" |

---

## Progressive Disclosure Pattern

The Tana MCP server supports **progressive disclosure** - a two-tier tool discovery pattern that reduces upfront token cost from ~2000 tokens to ~1000 tokens.

### Why Progressive Disclosure?

Loading 16 tool schemas upfront consumes significant context. Progressive disclosure lets AI agents:
1. Start with a lightweight overview (~1000 tokens)
2. Load full schemas only for tools they need (~500 tokens each)

### How It Works

**Step 1: Discover Capabilities**

```
Agent: "What can this MCP server do?"
→ Calls tana_capabilities
→ Gets categorized tool list with brief descriptions and examples
```

**Step 2: Load Schemas On-Demand**

```
Agent: "I need to search"
→ Calls tana_tool_schema with tool="tana_search"
→ Gets full parameter schema for search
```

**Step 3: Execute Tools**

```
Agent: Uses loaded schema to call tana_search with validated parameters
```

### Example Workflow

```json
// Step 1: Agent asks what's available
{"tool": "tana_capabilities"}

// Response: Lightweight overview
{
  "version": "1.3.4",
  "categories": [
    {
      "name": "query",
      "description": "Search and find content",
      "tools": [
        {"name": "tana_search", "description": "Full-text search", "example": "Search by keywords"}
      ]
    }
  ],
  "quickActions": ["search", "create", "tagged", "show"]
}

// Step 2: Agent loads schema for needed tool
{"tool": "tana_tool_schema", "arguments": {"tool": "tana_search"}}

// Response: Full schema
{
  "tool": "tana_search",
  "schema": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "description": "Search query"},
      "limit": {"type": "number", "default": 100}
    },
    "required": ["query"]
  }
}

// Step 3: Agent executes with validated parameters
{"tool": "tana_search", "arguments": {"query": "meeting notes", "limit": 10}}
```

### Token Savings

| Pattern | Token Cost |
|---------|------------|
| **Traditional**: All 16 schemas upfront | ~2000 tokens |
| **Progressive**: Capabilities only | ~1000 tokens |
| **Progressive**: Capabilities + 1 schema | ~1500 tokens |
| **Progressive**: Capabilities + 3 schemas | ~2000 tokens |

Progressive disclosure breaks even at ~3 tools and saves tokens for most use cases.

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

## Output Field Selection

Most query tools support a `select` parameter to return only specific fields, reducing token usage when you don't need the full response.

**Supported tools:** `tana_search`, `tana_semantic_search`, `tana_tagged`, `tana_node`, `tana_field_values`

**Examples:**

```json
// Only get id and name fields
{"query": "meeting", "select": ["id", "name"]}

// Get id, name, and tags
{"query": "project", "select": ["id", "name", "tags"]}

// Access nested fields with dot notation
{"nodeId": "abc123", "select": ["id", "name", "fields"]}
```

**Field paths:**
- Simple fields: `id`, `name`, `tags`, `similarity`
- Nested fields: `ancestor.name`, `ancestor.tags`
- Arrays: `fields`, `children` (returns full array)

When `select` is omitted or empty, all fields are returned (default behavior).

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

## Creating Hierarchical/Nested Content

Children can have their own `children` arrays for deep nesting. This is perfect for structured notes, outlines, and hierarchical content:

```json
{
  "supertag": "meeting",
  "name": "Workshop Notes",
  "children": [
    {
      "name": "Key Concepts",
      "children": [
        {"name": "Concept 1: Introduction to topic"},
        {"name": "Concept 2: Advanced techniques"}
      ]
    },
    {
      "name": "Action Items",
      "children": [
        {"name": "Review documentation"},
        {"name": "Schedule follow-up meeting"}
      ]
    }
  ]
}
```

This creates a hierarchical structure in Tana:
```
- Workshop Notes #meeting
  - Key Concepts
    - Concept 1: Introduction to topic
    - Concept 2: Advanced techniques
  - Action Items
    - Review documentation
    - Schedule follow-up meeting
```

Nesting can go as deep as needed - children at any level can have their own children.

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
- "Which meetings have transcripts?"
- "Show me the transcript from last week's planning meeting"
- "Find where we discussed the pricing strategy in meetings"

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Tools not appearing | Verify path is absolute, restart app |
| Database not found | Run `supertag sync index` |
| Schema empty | Run `supertag schema sync` |
| Debug mode | Add `"DEBUG": "true"` to env |
