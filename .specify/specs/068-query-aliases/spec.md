---
id: "068"
feature: "Query Aliases/Templates"
status: "draft"
created: "2026-01-01"
---

# Specification: Query Aliases/Templates

## Overview

Add the ability to save, name, and reuse frequently used queries as aliases (CLI) and templates (MCP). Enables users to define shortcuts for complex queries and share common patterns.

## User Scenarios

### Scenario 1: Save Frequent Query as Alias

**As a** CLI user who runs the same query often
**I want to** save it as a named alias
**So that** I can run it with a short command

**Acceptance Criteria:**
- [ ] `supertag alias save weekly-meetings "search meeting --after 7d"` saves alias
- [ ] `supertag alias run weekly-meetings` executes the saved query
- [ ] Aliases persist across sessions
- [ ] Can list all aliases: `supertag alias list`

### Scenario 2: Parameterized Templates

**As a** user with variable queries
**I want to** define templates with placeholders
**So that** I can reuse patterns with different values

**Acceptance Criteria:**
- [ ] Template: `"search {tag} --after {days}d"`
- [ ] Run: `supertag alias run find-recent tag=meeting days=7`
- [ ] Missing parameters prompt user or error
- [ ] Default values supported: `{days=7}`

### Scenario 3: AI Agent Using Templates

**As an** AI agent
**I want to** use predefined query templates
**So that** I follow established patterns and get consistent results

**Acceptance Criteria:**
- [ ] `tana_template_list` returns available templates
- [ ] `tana_template_run` executes template with parameters
- [ ] Templates defined in workspace config
- [ ] AI can discover what templates exist

### Scenario 4: Share Common Patterns

**As a** team member
**I want to** share useful query patterns
**So that** everyone can use optimized queries

**Acceptance Criteria:**
- [ ] Aliases stored in version-controllable location
- [ ] Can import/export aliases as JSON
- [ ] Workspace-level aliases distinct from user-level

## Functional Requirements

### FR-1: Alias Management Commands

CLI commands for managing aliases:

```bash
# Save a new alias
supertag alias save <name> "<command>"

# Run a saved alias
supertag alias run <name> [key=value...]

# List all aliases
supertag alias list

# Show alias definition
supertag alias show <name>

# Delete an alias
supertag alias delete <name>

# Export aliases
supertag alias export > aliases.json

# Import aliases
supertag alias import < aliases.json
```

**Validation:** All commands work as expected.

### FR-2: Alias Storage

Aliases stored in user config:

```json
// ~/.config/supertag/aliases.json
{
  "weekly-meetings": {
    "command": "search meeting --after 7d --limit 50",
    "description": "Meetings from the last week",
    "created": "2025-12-31T10:00:00Z"
  },
  "overdue-tasks": {
    "command": "query \"find task where Due < today and Status != Done\"",
    "description": "Tasks past due date",
    "created": "2025-12-31T10:00:00Z"
  }
}
```

**Validation:** Aliases persist, can be edited manually.

### FR-3: Parameterized Templates

Support placeholder substitution:

```bash
# Save template with placeholders
supertag alias save find-by-tag "search --tag {tag} --after {days=7}d"

# Run with parameters
supertag alias run find-by-tag tag=meeting
supertag alias run find-by-tag tag=task days=30
```

**Placeholder syntax:**
- `{name}` - required parameter
- `{name=default}` - optional with default

**Validation:** Parameters substituted correctly.

### FR-4: MCP Template Tools

MCP tools for template discovery and execution:

```typescript
// List available templates
tana_template_list({})
// Returns: [{ name: "weekly-meetings", description: "...", parameters: [] }, ...]

// Run a template
tana_template_run({
  name: "find-by-tag",
  parameters: { tag: "meeting", days: 7 }
})
// Returns: query results
```

**Validation:** AI can discover and use templates.

### FR-5: Workspace-Level Templates

Templates can be defined at workspace level:

```json
// ~/.config/supertag/workspaces/main/templates.json
{
  "team-standup": {
    "command": "search meeting --tag standup --after 1d",
    "description": "Today's standups"
  }
}
```

**Validation:**
- Workspace templates override user templates of same name
- `--workspace` flag scopes template operations

### FR-6: Alias Validation

Validate aliases before saving:

**Validation:**
- Command syntax is valid
- Referenced commands exist
- Parameters are valid identifiers
- No recursive alias references

## Non-Functional Requirements

- **Performance:** Alias lookup < 10ms
- **Portability:** Alias files are JSON, easy to version control
- **Safety:** Aliases can't execute arbitrary shell commands

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| Alias | Saved command shortcut | `name`, `command`, `description`, `parameters` |
| AliasParameter | Template placeholder | `name`, `default?`, `required` |
| AliasStore | Collection of aliases | `aliases: Map<string, Alias>` |

## Success Criteria

- [ ] "Save this query" workflow works smoothly
- [ ] Parameterized templates substitute correctly
- [ ] AI can discover and use templates via MCP
- [ ] Aliases persist and can be version controlled
- [ ] Workspace-level templates work

## Assumptions

- Users understand variable substitution syntax
- Alias names are valid identifiers (no spaces)
- Commands don't need shell features (pipes, redirects)

## [NEEDS CLARIFICATION]

- Should aliases support shell features (pipes, etc.)?
- Should we support alias chaining (alias calls another alias)?
- Should templates include expected output format?

## Out of Scope

- Macro recording (record sequence of commands)
- Conditional logic in templates
- Scheduling/cron for aliases
- Alias versioning/history
- Sharing via cloud service
