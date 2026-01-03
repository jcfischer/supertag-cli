---
id: "067"
feature: "CLI Interactive Mode"
status: "draft"
created: "2026-01-01"
---

# Specification: CLI Interactive Mode

## Overview

Add an interactive REPL (Read-Eval-Print Loop) mode to the CLI that allows users to explore Tana data conversationally, refine queries incrementally, and maintain context between commands without restarting.

## User Scenarios

### Scenario 1: Exploratory Data Discovery

**As a** user exploring my Tana data
**I want to** run queries and refine them interactively
**So that** I can discover insights without retyping full commands

**Acceptance Criteria:**
- [ ] `supertag interactive` starts REPL session
- [ ] Can run any supertag command without `supertag` prefix
- [ ] Results are displayed and stored for reference
- [ ] Can quit with `exit`, `quit`, or Ctrl+D

### Scenario 2: Result Refinement

**As a** user who ran a broad query
**I want to** filter the results further
**So that** I can narrow down without re-querying the database

**Acceptance Criteria:**
- [ ] `filter Status = Done` filters previous results
- [ ] `show 1` shows details of result #1
- [ ] `show 1-5` shows details of results 1 through 5
- [ ] Results maintain indices across filter operations

### Scenario 3: Context Persistence

**As a** user working with a specific project
**I want to** set a context/scope
**So that** all queries are implicitly scoped

**Acceptance Criteria:**
- [ ] `context set <nodeId>` sets current scope
- [ ] Subsequent queries are relative to that node
- [ ] `context clear` removes scope
- [ ] `context show` displays current scope

### Scenario 4: Export and Save

**As a** user who found useful data
**I want to** export results to a file
**So that** I can save or share findings

**Acceptance Criteria:**
- [ ] `export csv results.csv` exports current results to CSV
- [ ] `export json results.json` exports to JSON
- [ ] `copy` copies results to clipboard (if supported)
- [ ] Works with filtered result sets

## Functional Requirements

### FR-1: REPL Session

Start interactive mode with session state:

```bash
$ supertag interactive
Supertag Interactive Mode (v0.7.0)
Type 'help' for commands, 'exit' to quit.

supertag> search project
Found 45 results
[1] Project Alpha (meeting)
[2] Project Beta (project)
...

supertag> filter tags contains project
Filtered to 12 results

supertag> show 1
[Detailed view of result 1]

supertag> exit
```

**Validation:** Session maintains state, commands work without prefix.

### FR-2: Command Shortcuts

Common operations have short forms:

| Short | Full Command |
|-------|--------------|
| `s` | `search` |
| `t` | `tags` |
| `n` | `nodes` |
| `?` | `help` |
| `!!` | Repeat last command |
| `!5` | Repeat command #5 from history |

**Validation:** Shortcuts work as expected.

### FR-3: Result Reference

Access previous results by index:

```
supertag> search meeting
Found 10 results
[1] Weekly Standup
[2] Q4 Planning
...

supertag> show 2
[Shows Q4 Planning details]

supertag> related 2
[Shows nodes related to Q4 Planning]
```

**Validation:** Numeric indices reference results from last query.

### FR-4: Filter Command

Filter current results without re-querying:

```
supertag> filter name ~ Alpha
supertag> filter created > 2025-12-01
supertag> filter tags contains project
```

**Validation:** Filters chain/combine, apply to in-memory results.

### FR-5: History and Recall

Command history persists across sessions:

**Validation:**
- Up/Down arrows navigate history
- `history` shows recent commands
- `!n` reruns command #n
- History saved to `~/.cache/supertag/repl_history`

### FR-6: Context Scoping

Set implicit context for queries:

```
supertag> context set abc123    # Set context to node abc123
Context: Project Alpha

supertag> search meeting        # Searches within Project Alpha subtree
Found 5 results

supertag> context clear
Context cleared
```

**Validation:** Context scopes all subsequent queries.

### FR-7: Export Commands

Export current results:

```
supertag> export csv ~/results.csv
Exported 12 results to ~/results.csv

supertag> export json --pretty ~/results.json
Exported 12 results to ~/results.json

supertag> copy
Copied 12 results to clipboard
```

**Validation:** Export produces valid files, clipboard works on macOS.

### FR-8: Help System

Contextual help in interactive mode:

```
supertag> help
Available commands: search, filter, show, export, context, history, exit

supertag> help search
search <query> [--tag <tag>] [--semantic] [--limit <n>]
  Search for nodes matching query text.
  Examples:
    search project
    search "meeting notes" --tag meeting
```

**Validation:** Help is available for all commands.

## Non-Functional Requirements

- **Performance:** Prompt response < 50ms
- **Usability:** Tab completion for commands and tags
- **Persistence:** History saved between sessions
- **Compatibility:** Works in standard terminals (iTerm, Terminal.app, Windows Terminal)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| ReplSession | Active session state | `results`, `context`, `history` |
| ResultSet | Query results with indices | `items[]`, `indices` |
| ReplCommand | Parsed user input | `command`, `args`, `flags` |

## Success Criteria

- [ ] Users can explore data without retyping `supertag` prefix
- [ ] Filter command reduces results in-memory
- [ ] Result indices persist for reference
- [ ] History persists across sessions
- [ ] Tab completion works for commands

## Assumptions

- Users are comfortable with REPL interfaces
- Terminal supports ANSI colors and cursor movement
- readline-like functionality available (arrow keys, history)

## [NEEDS CLARIFICATION]

- Should we support multi-line queries?
- Should we support scripting/macro recording?
- How to handle very large result sets (pagination)?

## Out of Scope

- GUI / TUI with panels
- Vim/Emacs keybindings
- Mouse support
- Remote/network REPL access
- Web-based interface
