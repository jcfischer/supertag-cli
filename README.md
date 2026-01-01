# Supertag CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/jcfischer/supertag-cli/actions/workflows/test.yml/badge.svg)](https://github.com/jcfischer/supertag-cli/actions/workflows/test.yml)

**Complete Tana integration**: Query, write, search, and automate your Tana workspace from the command line.

## Three-Tool Architecture

| Tool | Size | Purpose |
|------|------|---------|
| `supertag` | ~57 MB | Main CLI - query, write, sync, server |
| `supertag-export` | ~59 MB | Browser automation for exports |
| `supertag-mcp` | ~60 MB | MCP server for AI tool integration |

**Downloads**: [GitHub Releases](https://github.com/jcfischer/supertag-cli/releases) (macOS ARM64/Intel, Linux x64, Windows x64)

**New to Supertag?** Check out the [Visual Getting Started Guide](./docs/GETTING-STARTED.md) with step-by-step screenshots.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Capabilities](#capabilities)
  - [READ - Query Workspace](#read---query-workspace)
  - [WRITE - Create Nodes](#write---create-nodes)
  - [EXPORT - Automated Backup](#export---automated-backup)
  - [EMBED - Semantic Search](#embed---semantic-search)
  - [FIELDS - Query Field Values](#fields---query-field-values)
  - [TRANSCRIPTS - Meeting Recordings](#transcripts---meeting-recordings)
  - [SERVER - Webhook API](#server---webhook-api)
  - [VISUALIZE - Inheritance Graphs](#visualize---inheritance-graphs)
  - [CODEGEN - Generate Effect Schema Classes](#codegen---generate-effect-schema-classes)
  - [MCP - AI Tool Integration](#mcp---ai-tool-integration)
  - [WORKSPACES - Multi-Workspace](#workspaces---multi-workspace)
  - [OUTPUT - Display Formatting](#output---display-formatting)
- [Examples](#examples)
- [Installation](#installation)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)
- [Performance](#performance)
- [Contributing](#contributing)

---

## Quick Start

> **Need detailed instructions?** See platform-specific guides: [Windows](./docs/INSTALL-WINDOWS.md) | [macOS](./docs/INSTALL-MACOS.md) | [Linux](./docs/INSTALL-LINUX.md)

### 1. Download and Extract

```bash
unzip supertag-cli-vX.Y.Z-macos-arm64.zip
cd supertag-cli-macos-arm64

# macOS: Remove quarantine
xattr -d com.apple.quarantine ./supertag ./supertag-mcp ./supertag-export
```

### 2. Configure API Token

Get your token from: https://app.tana.inc/?bundle=settings&panel=api

```bash
./supertag config --token "your_token_here"
```

### 3. Login and Export

```bash
./supertag-export login      # Opens browser for Tana login
./supertag-export discover   # Find your workspaces
./supertag-export run        # Export your data
./supertag sync index        # Index the export
```

### 4. Start Using

```bash
./supertag search "meeting"                    # Full-text search
./supertag search "project ideas" --semantic   # Semantic search
./supertag create todo "Buy groceries"         # Create nodes
./supertag stats                               # Database stats
```

---

## Capabilities

### READ - Query Workspace

```bash
supertag search "project"                    # Full-text search
supertag search "project" --semantic         # Semantic search
supertag search "todo" --tag todo            # Find by supertag
supertag search --tag meeting --field "Location=Zurich"  # Filter by field
supertag nodes show <id> --depth 3           # Node contents
supertag tags top                            # Most used tags
supertag tags inheritance manager            # Show tag hierarchy
supertag tags fields meeting --all           # Show tag fields
supertag tags visualize                      # Inheritance graph (mermaid)
supertag tags visualize --format dot         # Graphviz DOT format
supertag stats                               # Statistics
```

### WRITE - Create Nodes

```bash
supertag create todo "Task name" --status active
supertag create meeting "Team Standup" --date 2025-12-06
supertag create video,towatch "Tutorial" --url https://example.com
```

### EXPORT - Automated Backup

```bash
supertag-export login        # First-time login
supertag-export run          # Export workspace
supertag-export run --all    # Export all workspaces
```

See [Export Documentation](./docs/export.md) for details.

### EMBED - Semantic Search

```bash
supertag embed config --model bge-m3    # Configure
supertag embed generate                  # Generate embeddings
supertag embed generate --include-fields # Include field values in context
supertag search "ideas" --semantic       # Search by meaning
```

See [Embeddings Documentation](./docs/embeddings.md) for details.

### FIELDS - Query Field Values

Query structured field data from Tana nodes. Fields like "Summary", "Action Items", or custom fields store values in tuple children.

```bash
# Discover what fields exist
supertag fields list                              # List all field names with counts

# Query specific fields
supertag fields values "Summary" --limit 10       # Get values for a field
supertag fields values "Action Items" --after 2025-01-01  # Filter by date

# Full-text search
supertag fields search "meeting notes"            # FTS search in all fields
supertag fields search "project" --field Summary  # Search within specific field

# Export for analysis
supertag fields values "Gratitude" --json > reflections.json
```

See [Field Values Documentation](./docs/fields.md) for details.

### TRANSCRIPTS - Meeting Recordings

Query and search meeting transcripts. By default, transcripts are excluded from general search to keep results clean.

```bash
# List meetings with transcripts
supertag transcript list                      # Tab-separated output
supertag transcript list --pretty             # Formatted table
supertag transcript list --limit 10           # Recent 10 meetings

# View transcript content
supertag transcript show <meeting-id>         # Full transcript with speakers
supertag transcript show <id> --pretty        # Formatted with speaker sections
supertag transcript show <id> --json          # JSON with timing metadata

# Search within transcripts only
supertag transcript search "budget"           # Find spoken mentions
supertag transcript search "quarterly" --limit 5
```

**Include in embeddings:**
```bash
supertag embed generate --include-transcripts  # Opt-in for semantic search
```

See [Transcript Documentation](./docs/transcripts.md) for details.

### SERVER - Webhook API

```bash
supertag server start --port 3100 --daemon
curl http://localhost:3100/search -d '{"query": "meeting"}'
```

See [Webhook Server Documentation](./docs/WEBHOOK-SERVER.md) for API reference.

### VISUALIZE - Inheritance Graphs

Generate visual representations of your supertag inheritance hierarchy.

```bash
# Mermaid flowchart (default) - paste into Obsidian, GitHub, etc.
supertag tags visualize

# Graphviz DOT format - render with `dot -Tpng`
supertag tags visualize --format dot

# JSON data structure for custom tooling
supertag tags visualize --format json

# Filter options
supertag tags visualize --root entity              # Subtree from a tag
supertag tags visualize --direction LR             # Left-to-right layout
supertag tags visualize --show-fields              # Show field counts
supertag tags visualize --colors                   # Use tag colors (DOT)

# Write to file
supertag tags visualize --output graph.md
supertag tags visualize --format dot --output graph.dot
```

**Output formats:**
- `mermaid` - Mermaid flowchart syntax (default)
- `dot` - Graphviz DOT for rendering to SVG/PNG/PDF
- `json` - Raw data for custom visualization

See [Visualization Documentation](./docs/visualization.md) for rendering instructions.

### CODEGEN - Generate Effect Schema Classes

Generate type-safe Effect Schema class definitions from your Tana supertags.

```bash
# Generate single file with all supertags
supertag codegen generate -o ./generated/schemas.ts

# Filter to specific supertags
supertag codegen generate -o ./generated/todo.ts --tags TodoItem Meeting

# Generate separate files per supertag
supertag codegen generate -o ./generated/schemas.ts --split

# Preview without writing
supertag codegen generate -o ./generated/schemas.ts --dry-run
```

**Output Example:**
```typescript
import { Schema } from "effect";

export class TodoItem extends Schema.Class<TodoItem>("TodoItem")({
  id: Schema.String,
  title: Schema.optionalWith(Schema.String, { as: "Option" }),
  dueDate: Schema.optionalWith(Schema.DateFromString, { as: "Option" }),
  completed: Schema.optionalWith(Schema.Boolean, { as: "Option" }),
}) {}

// Child class extends parent
export class WorkTask extends TodoItem.extend<WorkTask>("WorkTask")({
  project: Schema.optionalWith(Schema.String, { as: "Option" }),
}) {}
```

**Options:**

| Flag | Description |
|------|-------------|
| `-o, --output <path>` | Output file path (required) |
| `-t, --tags <tags...>` | Filter to specific supertags |
| `--split` | Generate separate file per supertag |
| `--optional <strategy>` | `option` (default), `undefined`, or `nullable` |
| `--no-metadata` | Exclude supertag metadata comments |
| `-d, --dry-run` | Preview without writing files |

**Type Mapping:**

| Tana Type | Effect Schema |
|-----------|---------------|
| text | `Schema.String` |
| number | `Schema.Number` |
| date | `Schema.DateFromString` |
| checkbox | `Schema.Boolean` |
| url | `Schema.String.pipe(Schema.pattern(/^https?:\/\//))` |
| email | `Schema.String` |
| reference | `Schema.String` |
| options | `Schema.String` |

### MCP - AI Tool Integration

Integrate with Claude Desktop, ChatGPT, Cursor, VS Code, and other MCP-compatible AI tools.

```json
{
  "mcpServers": {
    "tana": { "command": "/path/to/supertag-mcp" }
  }
}
```

See [MCP Documentation](./docs/mcp.md) for setup guides.

### WORKSPACES - Multi-Workspace

```bash
supertag workspace list
supertag workspace add <rootFileId> --alias work
supertag search "meeting" -w work
```

See [Workspaces Documentation](./docs/workspaces.md) for details.

### OUTPUT - Display Formatting

All commands support `--format <type>` with these options:

| Format | Description | Use Case |
|--------|-------------|----------|
| `table` | Human-readable with emojis | Interactive terminal use |
| `json` | Pretty-printed JSON array | API integration, jq processing |
| `csv` | RFC 4180 compliant CSV | Excel, spreadsheets |
| `ids` | One ID per line | xargs piping, scripting |
| `minimal` | Compact JSON (id, name, tags) | Quick lookups |
| `jsonl` | JSON Lines (streaming) | Log processing, large datasets |

```bash
# Explicit format selection
supertag search "meeting" --format csv > meetings.csv
supertag tags list --format ids | xargs -I{} supertag tags show {}
supertag search "project" --format jsonl >> results.jsonl

# TTY auto-detection (interactive terminal gets table output)
supertag search "meeting"                  # Rich table in terminal
supertag search "meeting" | jq '.[0]'      # JSON when piped

# Shortcuts (legacy support)
supertag search "meeting" --pretty         # Same as --format table
supertag search "meeting" --json           # Same as --format json

# Select specific fields (reduces output)
supertag search "meeting" --json --select id,name,tags
supertag nodes show <id> --json --select id,name,fields
supertag fields values Status --json --select valueText,parentId

# Verbose mode: Additional details
supertag search "meeting" --verbose    # Adds timing info
supertag tags top --verbose            # Adds tag IDs
```

**Format Resolution Priority:**

1. `--format <type>` flag (explicit)
2. `--json` or `--pretty` flags (shortcuts)
3. `SUPERTAG_FORMAT` environment variable
4. Config file (`output.format`)
5. TTY detection: `table` for interactive, `json` for pipes/scripts

**Output Flags:**

| Flag | Description |
|------|-------------|
| `--format <type>` | Output format (table, json, csv, ids, minimal, jsonl) |
| `--pretty` | Shortcut for `--format table` |
| `--json` | Shortcut for `--format json` |
| `--select <fields>` | Select specific fields in JSON output (comma-separated) |
| `--verbose` | Include technical details (timing, IDs) |
| `--human-dates` | Localized date format (Dec 23, 2025) |
| `--no-header` | Omit header row in CSV output |

**Configuration:**

Set defaults in `~/.config/supertag/config.json`:

```json
{
  "output": {
    "format": "table",
    "humanDates": false
  }
}
```

**Environment Variable:**

```bash
export SUPERTAG_FORMAT=csv  # Default to CSV output
```

---

## Examples

The `examples/` directory contains sample applications demonstrating supertag-cli features:

### TUI Todo (`examples/tui-todo/`)

A terminal-based todo manager built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs). Demonstrates:

- **Codegen integration**: Uses Effect Schema classes generated from Tana supertags
- **SQLite queries**: Reads from the supertag-cli indexed database
- **Tana Input API**: Creates new todos directly in Tana
- **Split-pane UI**: Vim-style navigation with search/filter

```bash
cd examples/tui-todo
bun install
bun run start
```

See [examples/tui-todo/README.md](./examples/tui-todo/README.md) for full documentation.

---

## Installation

**Detailed installation guides:**

| Platform | Guide |
|----------|-------|
| **Windows** | [Windows Installation Guide](./docs/INSTALL-WINDOWS.md) |
| **macOS** | [macOS Installation Guide](./docs/INSTALL-MACOS.md) |
| **Linux** | [Linux Installation Guide](./docs/INSTALL-LINUX.md) |

### Quick Install (macOS/Linux)

```bash
# Download and extract from GitHub Releases
unzip supertag-cli-vX.Y.Z-*.zip
cd supertag-cli-*

# macOS: Remove quarantine
xattr -d com.apple.quarantine ./supertag ./supertag-mcp ./supertag-export

# Symlink to PATH
sudo ln -s $(pwd)/supertag /usr/local/bin/supertag
sudo ln -s $(pwd)/supertag-export /usr/local/bin/supertag-export
sudo ln -s $(pwd)/supertag-mcp /usr/local/bin/supertag-mcp

# Install Playwright for browser automation
curl -fsSL https://bun.sh/install | bash
bunx playwright install chromium
```

### Playwright (Required for Export)

The `supertag-export` tool requires Playwright for browser automation. See the platform-specific guides above for detailed instructions.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./docs/GETTING-STARTED.md) | Visual guide with step-by-step screenshots |
| [Windows Install](./docs/INSTALL-WINDOWS.md) | Detailed Windows installation with Bun/Playwright |
| [macOS Install](./docs/INSTALL-MACOS.md) | macOS installation with launchd automation |
| [Linux Install](./docs/INSTALL-LINUX.md) | Linux installation with systemd automation |
| [MCP Integration](./docs/mcp.md) | AI tool setup (Claude, ChatGPT, Cursor, etc.) |
| [Embeddings](./docs/embeddings.md) | Semantic search configuration |
| [Field Values](./docs/fields.md) | Query and search field data from nodes |
| [Transcripts](./docs/transcripts.md) | Query and search meeting transcripts |
| [Visualization](./docs/visualization.md) | Inheritance graph rendering (Mermaid, DOT, PNG) |
| [Codegen](./docs/codegen.md) | Generate Effect Schema classes from supertags |
| [Webhook Server](./docs/WEBHOOK-SERVER.md) | HTTP API reference |
| [Workspaces](./docs/workspaces.md) | Multi-workspace management |
| [Export](./docs/export.md) | Automated backup and scheduling |
| [Development](./docs/development.md) | Building, testing, contributing |
| [Launchd Setup](./docs/LAUNCHD-SETUP.md) | macOS auto-start configuration |
| [Field Structures](./docs/TANA-FIELD-STRUCTURES.md) | Technical reference for Tana tuple/field patterns |
| [Database Schema](./docs/database-schema.md) | SQLite schema, tables, JSON storage |

---

## Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| "API token not configured" | `export TANA_API_TOKEN="your_token"` |
| "Database not found" | `supertag sync index` |
| "Chromium not found" | `supertag-export setup` |

### Debug Mode

Use the `--debug` flag for verbose error output with stack traces:

```bash
supertag search "test" --debug          # Show detailed errors
supertag create todo "Test" --debug     # Debug node creation
```

Debug mode shows:
- Full error codes (e.g., `WORKSPACE_NOT_FOUND`, `DATABASE_NOT_FOUND`)
- Stack traces for debugging
- Detailed context about what went wrong

### Error Logging

View and manage error logs with the `errors` command:

```bash
supertag errors                   # Show recent errors
supertag errors --last 10         # Show last 10 errors
supertag errors --json            # Output as JSON
supertag errors --export          # Export all errors
supertag errors --clear           # Clear error log
```

Error logs are stored at `~/.cache/supertag/errors.log` (up to 1000 entries).

### Error Codes

| Code | Meaning | Recovery |
|------|---------|----------|
| `WORKSPACE_NOT_FOUND` | Workspace alias not configured | Check `supertag workspace list` |
| `DATABASE_NOT_FOUND` | Database not indexed | Run `supertag sync index` |
| `TAG_NOT_FOUND` | Supertag doesn't exist | Check `supertag tags list` |
| `NODE_NOT_FOUND` | Node ID doesn't exist | Verify node ID |
| `API_ERROR` | Tana API request failed | Check token & network |
| `VALIDATION_ERROR` | Invalid input parameters | Check command options |

### Windows-Specific Issues

#### "Cannot find package 'playwright'" Error

When running `supertag-export login` on Windows, you may see:

```
error: Cannot find package 'playwright' from 'B:/~BUN/root/supertag-export.exe'
```

**Solution:** Install Playwright separately. The browser automation binaries cannot be bundled into the executable.

**Option 1: Using Node.js (Recommended)**

1. Install Node.js from https://nodejs.org (LTS version)
2. Open PowerShell and run:
   ```powershell
   npx playwright install chromium
   ```

**Option 2: Using Bun**

1. Install Bun from https://bun.sh
2. Open PowerShell and run:
   ```powershell
   bunx playwright install chromium
   ```

After installing Playwright, `supertag-export login` should work.

#### Alternative: Manual Export (No Playwright Required)

If you prefer not to install Node.js/Bun, you can export manually:

1. In Tana, go to **Settings → Export**
2. Select **JSON** format and export
3. Save the file to `%USERPROFILE%\Documents\Tana-Export\main\`
4. Run `.\supertag sync index` to index the export

This bypasses the need for `supertag-export` entirely.

#### Windows Path Configuration

To run `supertag` from any directory, add it to your PATH:

```powershell
# Add to current session
$env:PATH += ";C:\path\to\supertag-cli-windows-x64"

# Add permanently (run as Administrator)
[Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\path\to\supertag-cli-windows-x64", "User")
```

#### Windows API Token Configuration

```powershell
# Set for current session
$env:TANA_API_TOKEN = "your_token_here"

# Set permanently
[Environment]::SetEnvironmentVariable("TANA_API_TOKEN", "your_token_here", "User")
```

---

## Performance

| Operation | Performance |
|-----------|-------------|
| Indexing | 107k nodes/second |
| FTS5 Search | < 50ms |
| Database | ~500 MB for 1M nodes |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and pull request guidelines.

## Security

See [SECURITY.md](SECURITY.md) for security policy and vulnerability reporting.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built by Jens-Christian Fischer, 2025.
