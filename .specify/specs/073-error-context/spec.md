---
id: "073"
feature: "Error Context"
status: "draft"
created: "2026-01-01"
---

# Specification: Error Context

## Overview

Add comprehensive error context and recovery suggestions to all CLI and MCP tool errors. Enables AI agents and users to understand what went wrong and how to fix it, reducing frustration and support burden.

## User Scenarios

### Scenario 1: Actionable Error Messages

**As a** CLI user who made an error
**I want to** understand what went wrong and how to fix it
**So that** I can quickly recover without searching documentation

**Acceptance Criteria:**
- [ ] Error message explains what happened
- [ ] Suggests specific fix or next step
- [ ] Shows example of correct usage
- [ ] Links to relevant documentation

### Scenario 2: AI Agent Error Recovery

**As an** AI agent that received an error
**I want to** programmatically understand the error type and fix
**So that** I can automatically retry with corrections

**Acceptance Criteria:**
- [ ] Structured error response (not just string message)
- [ ] Error code for programmatic handling
- [ ] Suggested parameters for retry
- [ ] Related successful examples

### Scenario 3: Validation Errors

**As a** user who provided invalid input
**I want to** see exactly what's wrong with each field
**So that** I can fix all issues at once

**Acceptance Criteria:**
- [ ] All validation errors shown (not just first)
- [ ] Each error references specific field
- [ ] Shows expected format/type
- [ ] Highlights the problematic value

### Scenario 4: Debug Mode

**As a** developer debugging issues
**I want to** see full error context
**So that** I can diagnose complex problems

**Acceptance Criteria:**
- [ ] `--debug` shows full stack trace
- [ ] Shows internal state at error time
- [ ] Shows request/response details
- [ ] Logs can be saved for bug reports

## Functional Requirements

### FR-1: Structured Error Response

All errors return structured format:

```typescript
// MCP Error Response
{
  error: {
    code: "WORKSPACE_NOT_FOUND",
    message: "Workspace 'books' not found",
    details: {
      workspace: "books",
      availableWorkspaces: ["main", "work", "personal"]
    },
    suggestion: "Use one of the available workspaces, or create 'books' with 'supertag workspace add books'",
    example: "tana_search({ query: 'book', workspace: 'main' })",
    docUrl: "https://supertag.dev/docs/workspaces",
    recoverable: true,
    retryWith: {
      workspace: "main"
    }
  }
}

// CLI Error Output
Error: Workspace 'books' not found

Available workspaces: main, work, personal

Suggestion: Use one of the available workspaces, or create 'books' with:
  supertag workspace add books

Example:
  supertag search book --workspace main

Docs: https://supertag.dev/docs/workspaces
```

**Validation:** All errors include structured context.

### FR-2: Error Codes

Standardized error codes for programmatic handling:

| Category | Code | Description |
|----------|------|-------------|
| **Config** | `CONFIG_NOT_FOUND` | Config file missing |
| | `CONFIG_INVALID` | Config file malformed |
| | `WORKSPACE_NOT_FOUND` | Unknown workspace |
| | `API_KEY_MISSING` | Tana API key not set |
| **Input** | `INVALID_PARAMETER` | Bad parameter value |
| | `MISSING_REQUIRED` | Required param missing |
| | `INVALID_FORMAT` | Wrong format (date, etc.) |
| | `NODE_NOT_FOUND` | Node ID doesn't exist |
| | `TAG_NOT_FOUND` | Supertag not found |
| **Database** | `DATABASE_NOT_FOUND` | Need to run sync first |
| | `DATABASE_CORRUPT` | Database file damaged |
| | `DATABASE_LOCKED` | Another process has lock |
| | `SYNC_REQUIRED` | Data too stale |
| **Network** | `API_ERROR` | Tana API returned error |
| | `RATE_LIMITED` | Too many requests |
| | `TIMEOUT` | Request timed out |
| | `NETWORK_ERROR` | Connection failed |
| **Auth** | `AUTH_FAILED` | Authentication error |
| | `PERMISSION_DENIED` | Not authorized |
| **Internal** | `INTERNAL_ERROR` | Unexpected error |

**Validation:** All errors have appropriate code.

### FR-3: Validation Error Aggregation

Collect all validation errors:

```typescript
// Bad request
tana_create({
  name: "",                              // Error: empty
  tag: "nonexistent-tag",               // Error: not found
  fields: {
    "Due": "not-a-date"                 // Error: invalid format
  }
})

// Response
{
  error: {
    code: "VALIDATION_ERRORS",
    message: "3 validation errors",
    validationErrors: [
      {
        field: "name",
        code: "REQUIRED",
        message: "Name is required",
        value: ""
      },
      {
        field: "tag",
        code: "TAG_NOT_FOUND",
        message: "Tag 'nonexistent-tag' not found",
        value: "nonexistent-tag",
        suggestion: "Did you mean: 'task', 'meeting', 'project'?"
      },
      {
        field: "fields.Due",
        code: "INVALID_FORMAT",
        message: "Invalid date format",
        value: "not-a-date",
        expected: "YYYY-MM-DD or relative (today, tomorrow, +3d)"
      }
    ]
  }
}
```

**Validation:** All errors reported, not just first.

### FR-4: Contextual Suggestions

Smart suggestions based on error type:

| Error | Suggestion |
|-------|------------|
| `TAG_NOT_FOUND` | Did you mean: [similar tags]? |
| `NODE_NOT_FOUND` | Search for node: `supertag search "name"` |
| `DATABASE_NOT_FOUND` | Run: `supertag sync` to create database |
| `API_KEY_MISSING` | Set: `supertag config set apiKey <key>` |
| `RATE_LIMITED` | Retry after: X seconds |
| `INVALID_FORMAT` | Expected: [format description] |

**Validation:** Suggestions are actionable and specific.

### FR-5: Similar Value Suggestions

Suggest similar values for typos:

```typescript
// Typo in tag name
tana_tagged({ tag: "meetting" })

// Response
{
  error: {
    code: "TAG_NOT_FOUND",
    message: "Tag 'meetting' not found",
    suggestions: ["meeting", "meetings"],  // Levenshtein distance
    example: "tana_tagged({ tag: 'meeting' })"
  }
}
```

**Validation:** Similar values found using fuzzy matching.

### FR-6: Debug Mode

Verbose error output for debugging:

```bash
$ supertag search project --debug
[DEBUG] Loading config from ~/.config/supertag/config.json
[DEBUG] Using workspace: main
[DEBUG] Database path: ~/.local/share/supertag/workspaces/main/tana-index.db
[DEBUG] Executing query: SELECT ... WHERE name LIKE '%project%'
[ERROR] Database error: SQLITE_CORRUPT: database disk image is malformed

Error Details:
  Code: DATABASE_CORRUPT
  Database: ~/.local/share/supertag/workspaces/main/tana-index.db
  Query: SELECT ... (truncated)
  SQLite Error: SQLITE_CORRUPT (11)

Stack Trace:
  at Database.prepare (sqlite.ts:45)
  at search (search.ts:123)
  at main (cli.ts:89)

Suggestion: Database may be corrupted. Try:
  1. supertag sync --force
  2. If that fails, delete database and re-sync:
     rm ~/.local/share/supertag/workspaces/main/tana-index.db
     supertag sync
```

**Validation:** Debug mode shows full context.

### FR-7: Error Recovery Hints for AI

Machine-readable recovery info:

```typescript
{
  error: {
    code: "RATE_LIMITED",
    message: "Rate limit exceeded",
    recovery: {
      retryable: true,
      retryAfter: 30,                    // seconds
      retryStrategy: "exponential",
      maxRetries: 3
    }
  }
}

{
  error: {
    code: "NODE_NOT_FOUND",
    message: "Node 'abc123' not found",
    recovery: {
      retryable: false,
      alternativeAction: "search",
      alternativeParams: {
        query: "abc123"                  // Search by ID fragment
      }
    }
  }
}
```

**Validation:** AI can programmatically determine recovery.

### FR-8: Error Logging

Log errors for debugging:

```bash
# Error log location
~/.cache/supertag/errors.log

# Log entry format
[2026-01-01T12:00:00Z] ERROR WORKSPACE_NOT_FOUND
  workspace: books
  command: supertag search project --workspace books
  stack: ...
```

**CLI commands:**
```bash
supertag errors                          # Show recent errors
supertag errors --last 10                # Last 10 errors
supertag errors --clear                  # Clear error log
supertag errors --export > errors.json   # Export for bug report
```

**Validation:** Errors logged for later analysis.

## Non-Functional Requirements

- **Consistency:** Same error format across CLI and MCP
- **Performance:** Error formatting < 10ms
- **Privacy:** Don't log sensitive data in errors
- **Localization:** Error messages support i18n (future)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| StructuredError | Error response | `code`, `message`, `details` |
| ValidationError | Field-level error | `field`, `code`, `value`, `expected` |
| ErrorSuggestion | Recovery hint | `action`, `example`, `docUrl` |
| RecoveryInfo | AI recovery hints | `retryable`, `retryAfter`, `alternative` |

## Success Criteria

- [ ] All errors include actionable suggestions
- [ ] AI agents can programmatically handle errors
- [ ] Validation shows all errors at once
- [ ] Debug mode reveals full context

## Assumptions

- Error codes are stable (breaking change if modified)
- Documentation URLs remain valid
- Fuzzy matching library available

## [NEEDS CLARIFICATION]

- Should error messages support multiple languages?
  -> english only
- Should we collect anonymized error telemetry?
  -> no
- How verbose should non-debug errors be?
  -> as much as is needed for understanding

## Out of Scope

- Error telemetry/analytics
- Automated bug report submission
- Multi-language error messages
- Error notification/alerting
- Error rate dashboards
