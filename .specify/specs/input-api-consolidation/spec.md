---
id: "014"
feature: "Input API Consolidation"
status: "draft"
created: "2025-12-22"
---

# Specification: Input API Consolidation

## Overview

Consolidate duplicated Tana Input API node creation logic from the CLI command (`src/commands/create.ts`) and MCP tool (`src/mcp/tools/create.ts`) into a single shared module. This reduces maintenance burden, ensures consistent behavior, and provides a single source of truth for node creation.

## Current State Analysis

### Duplicated Code Areas

1. **Supertag parsing** - Both parse comma-separated supertag names
2. **Supertag validation** - Both validate against schema registry with suggestions
3. **Children building** - Both convert children to TanaApiNode format (references, URLs, plain text)
4. **Field value preparation** - Both prepare field values for `buildNodePayload()`
5. **Node payload assembly** - Both build final payload with supertags, fields, and children
6. **API token validation** - Both validate API token presence
7. **Dry run logic** - Both support validation without posting
8. **API client usage** - Both create client and post to same endpoint

### Lines of Code

- CLI: ~480 lines (includes CLI-specific I/O handling)
- MCP: ~160 lines (includes MCP-specific result handling)
- Estimated shared logic: ~120 lines duplicated

## User Scenarios

### Scenario 1: CLI Node Creation

**As a** CLI user
**I want to** create nodes via `supertag create <tag> "Name"`
**So that** I can add content to Tana from the terminal

**Acceptance Criteria:**
- [ ] CLI accepts same input formats (stdin, file, JSON arg, positional args)
- [ ] CLI outputs same messages and exit codes
- [ ] CLI verbose mode unchanged
- [ ] CLI dry run mode unchanged

### Scenario 2: MCP Tool Node Creation

**As an** AI agent using MCP
**I want to** create nodes via `tana_create` tool
**So that** I can add content to Tana programmatically

**Acceptance Criteria:**
- [ ] MCP tool accepts same input schema
- [ ] MCP tool returns same result structure
- [ ] MCP tool error messages unchanged
- [ ] MCP tool dry run mode unchanged

### Scenario 3: Developer Adding New Child Type

**As a** developer
**I want to** add a new child type (e.g., `code` blocks) in one place
**So that** both CLI and MCP get the feature automatically

**Acceptance Criteria:**
- [ ] New child type added in shared module only
- [ ] CLI and MCP both support new type without changes
- [ ] Tests for new type run once, cover both consumers

### Scenario 4: Bug Fix Propagation

**As a** maintainer
**I want to** fix a bug in node creation logic once
**So that** the fix applies to both CLI and MCP

**Acceptance Criteria:**
- [ ] Bug fix made in shared module
- [ ] No duplicate fixes needed in CLI or MCP
- [ ] Single test verifies the fix

## Functional Requirements

### FR-1: Node Builder Module

Create a `NodeBuilder` class/module that encapsulates node construction logic.

**Must support:**
- Single supertag name or comma-separated list
- Node name with inline references (`<span data-inlineref-node="ID">text</span>`)
- Field values as key-value pairs
- Children array with mixed types (plain text, references, URLs)

**Validation:** Unit tests for all input combinations

### FR-2: Child Node Conversion

Extract child node conversion to shared function.

**Must handle:**
- Plain text children: `{ name: "text" }`
- Reference children: `{ dataType: "reference", id: "NODE_ID" }`
- URL children: `{ name: "url", dataType: "url" }`
- Inline references in text preserved

**Validation:** Unit tests for each child type

### FR-3: Supertag Validation

Extract supertag validation with suggestions.

**Must provide:**
- Existence check against schema registry
- Similar supertag suggestions on error
- Support for comma-separated multiple tags

**Validation:** Unit tests for valid, invalid, and similar-match cases

### FR-4: Node Creator Service

Create a `NodeCreator` service that handles API interaction.

**Must support:**
- Dry run mode (validate only, no API call)
- Real mode (validate and post)
- Configurable target node
- Error handling with meaningful messages

**Validation:** Integration tests with mocked API

### FR-5: Backward Compatibility

CLI and MCP must maintain exact same external interface.

**Must preserve:**
- CLI command signature and options
- CLI output format and exit codes
- MCP tool input schema
- MCP tool result structure

**Validation:** Existing tests pass without modification

## Non-Functional Requirements

- **Performance:** No measurable impact on node creation time
- **Maintainability:** Single location for node creation logic
- **Testability:** Shared module has >90% test coverage
- **Dependencies:** No new external dependencies

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| NodeBuilder | Constructs TanaApiNode payloads | supertags, name, fields, children |
| ChildNode | Input format for children | name, id?, dataType? |
| NodeCreator | Handles API posting | config, payload, target, dryRun |
| CreateResult | Unified result type | success, nodeId?, error? |

## Success Criteria

- [ ] Zero duplicated node-building logic between CLI and MCP
- [ ] All existing tests pass without modification
- [ ] Shared module has dedicated test file with >90% coverage
- [ ] CLI and MCP files reduced by >50 lines each
- [ ] No breaking changes to external interfaces

## Assumptions

- Schema registry (`SchemaRegistry.buildNodePayload`) remains as-is
- API client (`TanaApiClient.postNodes`) remains as-is
- Only node creation logic is consolidated (not schema, query, etc.)

## [NEEDS CLARIFICATION]

- None identified - scope is well-defined based on code analysis

## Out of Scope

- Refactoring `SchemaRegistry` or `TanaApiClient`
- Consolidating other commands (query, sync, etc.)
- Changing public CLI or MCP interfaces
- Adding new features during consolidation
