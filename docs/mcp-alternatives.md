# MCP Client Alternatives

Looking for cheaper alternatives to Claude Code or Cursor for using supertag-mcp? This guide covers MCP-compatible tools that work with local LLMs (Ollama) or bring-your-own-API-key (BYOK) setups.

---

## Quick Comparison

| Tool | MCP Support | LLM Options | Cost | Best For |
|------|-------------|-------------|------|----------|
| [MCP Client for Ollama](#mcp-client-for-ollama) | Excellent | Ollama, Ollama Cloud | Free | Terminal-first, local LLMs |
| [Cline](#cline) | Excellent | All providers + local | BYOK | VS Code users, full agent |
| [Continue](#continue) | Good | All providers + local | Free/BYOK | Code completion + chat |
| [OpenAI Codex CLI](#openai-codex-cli) | Native | OpenAI, Ollama, LM Studio | BYOK | Terminal-first, hybrid |
| [LibreChat](#librechat) | Full | Any via BYOK | Self-hosted | Teams, web UI |

---

## Tier 1: Dedicated Ollama + MCP Solutions

### MCP Client for Ollama

**Best fit for local-first users.** A TUI (terminal UI) client specifically designed for MCP + Ollama.

**Features:**
- Multi-server support (connect to supertag-mcp + other servers)
- Agent mode with human-in-the-loop
- Model switching, streaming responses
- Supports Ollama Cloud for GPU-intensive models

**Installation:**

```bash
# Install Ollama
brew install ollama  # macOS
# or see https://ollama.com for other platforms

# Pull a tool-calling model
ollama pull qwen2.5:14b

# Run the MCP client
npx -y ollmcp
```

**Configuration** (`~/.mcp.json`):

```json
{
  "mcpServers": {
    "supertag": {
      "command": "/path/to/supertag-mcp"
    }
  }
}
```

**Links:**
- [GitHub: jonigl/mcp-client-for-ollama](https://github.com/jonigl/mcp-client-for-ollama)
- [MCP Servers Directory](https://mcpservers.org/servers/jonigl/mcp-client-for-ollama)

### Ollama MCP Bridge

**Drop-in Ollama API replacement** with MCP tool support. Use your existing Ollama clients/libraries.

**How it works:** Acts as a proxy for the Ollama API, automatically handling tool execution from connected MCP servers.

```bash
# Install and run
npx -y ollama-mcp-bridge
```

**Links:**
- [GitHub: jonigl/ollama-mcp-bridge](https://github.com/jonigl/ollama-mcp-bridge)

---

## Tier 2: IDE Extensions (BYOK)

### Cline

**Full autonomous agent** in VS Code with excellent MCP support.

**Features:**
- Can create its own MCP servers
- Supports all major providers: Anthropic, OpenAI, Google, AWS Bedrock, Azure
- Works with Ollama and LM Studio for local models
- Human-in-the-loop for every action
- Can use Claude subscription via Claude Code provider

**Installation:**

1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
2. Configure API provider in settings
3. Add MCP servers via UI or `cline_mcp_settings.json`

**MCP Configuration:**

```json
{
  "mcpServers": {
    "supertag": {
      "command": "/path/to/supertag-mcp"
    }
  }
}
```

**Cost with BYOK:**
| Model | Input | Output |
|-------|-------|--------|
| Claude Sonnet | $3/M tokens | $15/M tokens |
| Claude Haiku | $0.25/M tokens | $1.25/M tokens |
| GPT-4o | $2.50/M tokens | $10/M tokens |

**Links:**
- [GitHub: cline/cline](https://github.com/cline/cline)
- [Cline Documentation](https://docs.cline.bot/)

### Continue

**Open-source code assistant** for VS Code and JetBrains with MCP support.

**Features:**
- Code completion + chat
- Works with any OpenAI-compatible API
- Full Ollama integration for local models
- Lighter weight than Cline

**Installation:**

1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Continue.continue)
2. Configure in `~/.continue/config.yaml`

**Configuration for Ollama:**

```yaml
models:
  - name: qwen2.5
    provider: ollama
    model: qwen2.5:14b
    apiBase: http://localhost:11434

mcpServers:
  supertag:
    command: /path/to/supertag-mcp
```

**Configuration for Claude BYOK:**

```yaml
models:
  - name: claude-sonnet
    provider: anthropic
    model: claude-sonnet-4-20250514
    apiKey: ${ANTHROPIC_API_KEY}
```

**Links:**
- [Continue Documentation](https://docs.continue.dev)
- [MCP + Ollama Tutorial](https://medium.com/@greg.witt625/mcp-ollama-server-integration-with-continue-dev-58811b637c94)
- [Hugging Face MCP Course](https://huggingface.co/learn/mcp-course/unit2/continue-client)

---

## Tier 3: CLI Tools (BYOK)

### OpenAI Codex CLI

**Terminal-first** with native MCP support and local model fallback.

**Features:**
- Shared config between CLI and VS Code extension
- Supports `--oss` flag for Ollama/LM Studio
- Can run as MCP server itself

**Installation:**

```bash
npm install -g @openai/codex
```

**Configuration** (`~/.codex/config.toml`):

```toml
# Use Ollama by default with --oss flag
oss_provider = "ollama"

[mcp_servers.supertag]
command = "/path/to/supertag-mcp"
```

**Usage:**

```bash
# With OpenAI
codex -p "Search my Tana for meeting notes"

# With local Ollama
codex --oss -p "Search my Tana for meeting notes"
```

**Links:**
- [Codex CLI Documentation](https://developers.openai.com/codex/cli)
- [Codex MCP Configuration](https://developers.openai.com/codex/mcp/)

### Aider

**Excellent pair programming CLI** but no MCP support yet.

Works great with local LLMs and BYOK, but you'd need to use supertag CLI directly rather than through MCP.

```bash
# With Ollama
aider --model ollama/qwen2.5:14b

# With Claude BYOK
aider --model sonnet --api-key anthropic=sk-xxx
```

**Links:**
- [Aider Documentation](https://aider.chat/)
- [Aider API Keys](https://aider.chat/docs/config/api-keys.html)

---

## Tier 4: Self-Hosted Web UIs

### LibreChat

**Full-featured chat UI** with MCP support, designed for team deployments.

**Features:**
- Per-user MCP configurations
- Supports BYOK with `customUserVars`
- Docker-based deployment
- Multi-provider support

**Installation:**

```bash
git clone https://github.com/danny-avila/LibreChat
cd LibreChat
docker compose up
```

**MCP Configuration** (`librechat.yaml`):

```yaml
mcpServers:
  supertag:
    type: stdio
    command: /path/to/supertag-mcp
```

**Links:**
- [LibreChat MCP Documentation](https://www.librechat.ai/docs/features/mcp)
- [LibreChat GitHub](https://github.com/danny-avila/LibreChat)

---

## Model Recommendations for MCP

MCP requires good tool/function calling. Not all models handle it well.

### Best Local Models for Tool Calling

| Model | Size | Tool Calling | Notes |
|-------|------|--------------|-------|
| **Qwen 2.5** | 14B+ | Excellent | Best overall for MCP |
| **Llama 3.3** | 70B | Good | Needs more VRAM |
| **Mistral Large** | 123B | Good | Cloud or high-end GPU |

### Models That Struggle

| Model | Issue |
|-------|-------|
| Most <7B models | Inconsistent tool execution |
| Older Llama 2 | No native tool calling |
| Base models | Need instruction tuning |

### Recommendations

**For complex MCP workflows** (like supertag-mcp with 16+ tools):
1. **Ollama + Qwen 2.5 14B+** - Best local option
2. **Cline + Claude Haiku** - Very cheap, excellent tool calling
3. **Claude Sonnet via BYOK** - Best quality, moderate cost

**For simple queries:**
- Smaller models work fine for single-tool calls
- Use `tana_capabilities` → `tana_tool_schema` pattern to reduce context

---

## Cost Comparison

| Setup | Monthly Cost (Light Use) | Monthly Cost (Heavy Use) |
|-------|-------------------------|-------------------------|
| Claude Code Max | $100/month flat | $100/month flat |
| Cursor Pro | $20/month | $20/month |
| Ollama local | $0 | $0 (electricity) |
| Claude Haiku BYOK | ~$1-5 | ~$10-30 |
| Claude Sonnet BYOK | ~$5-20 | ~$50-150 |
| GPT-4o BYOK | ~$5-15 | ~$40-100 |

**Note:** BYOK costs vary significantly based on usage patterns. Heavy agentic use with many tool calls costs more than simple chat.

---

## Getting Started

### Fastest Path to Local + Free

```bash
# 1. Install Ollama
brew install ollama

# 2. Pull a good tool-calling model
ollama pull qwen2.5:14b

# 3. Run MCP client
npx -y ollmcp

# 4. Start chatting with your Tana data
> Search my Tana for project notes
```

### Fastest Path to BYOK + Cheap

1. Get an [Anthropic API key](https://console.anthropic.com/)
2. Install [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) in VS Code
3. Configure Anthropic provider with your key
4. Add supertag-mcp to Cline's MCP settings
5. Use Claude Haiku for most tasks (~$0.25/M input tokens)

---

## See Also

- [MCP Integration Guide](./mcp.md) - Setting up supertag-mcp
- [Local LLMs section in mcp.md](./mcp.md#local-llms-ollama) - mcphost setup
- [Model Context Protocol](https://modelcontextprotocol.io/) - Official MCP documentation
