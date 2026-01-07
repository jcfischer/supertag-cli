---
feature: "System Field Discovery"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: System Field Discovery

## Architecture Overview

Enhance the existing field discovery pipeline to include system fields (SYS_A*) that are defined on ancestor supertags. The solution has two parts:

1. **Static metadata** - Define known system field IDs and their properties
2. **Dynamic discovery** - During sync, discover which tagDefs define system fields and store this mapping

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│  Export JSON                                                    │
│      ↓                                                          │
│  Indexer (extracts tagDef tuples)                               │
│      ↓                                                          │
│  supertag_fields table (stores field definitions)               │
│      ↓                                                          │
│  SupertagMetadataService.getAllFields()                         │
│      ↓                                                          │
│  tana_supertag_info / node-builder                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    NEW ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────┤
│  Export JSON                                                    │
│      ↓                                                          │
│  Indexer (extracts tagDef tuples)                               │
│      ↓ [NEW: Record system field source tagDefs]                │
│  supertag_fields + system_field_sources tables                  │
│      ↓                                                          │
│  SupertagMetadataService.getAllFields()                         │
│      ↓ [NEW: Include system fields from ancestors]              │
│  tana_supertag_info / node-builder                              │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard |
| Runtime | Bun | PAI standard |
| Database | SQLite | Already used for schema storage |
| ORM | None (raw SQL) | Consistent with existing code |

## Constitutional Compliance

- [x] **CLI-First:** `supertag tags fields <tag>` already exposes field discovery, will now include system fields
- [x] **Library-First:** Core logic in SupertagMetadataService, reusable by CLI and MCP
- [x] **Test-First:** 8+ test cases defined in spec, will write tests before implementation
- [x] **Deterministic:** Discovery is based on export data, no probabilistic behavior
- [x] **Code Before Prompts:** All logic in TypeScript, no AI prompts involved

## Data Model

### Entities

```typescript
// Static metadata for known system fields (in code)
interface SystemFieldMetadata {
  /** Field ID (e.g., "SYS_A142") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Normalized name for matching */
  normalizedName: string;
  /** Data type */
  dataType: 'date' | 'reference' | 'text';
}

// Existing SupertagField with new system flag
interface SupertagField {
  // ... existing fields ...
  /** True if this is a system field */
  system?: boolean;
}
```

### Database Schema

```sql
-- New table: tracks which tagDefs define which system fields
CREATE TABLE IF NOT EXISTS system_field_sources (
  id INTEGER PRIMARY KEY,
  field_id TEXT NOT NULL,        -- e.g., "SYS_A142"
  tag_id TEXT NOT NULL,          -- tagDef ID that defines this field
  UNIQUE(field_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_system_field_sources_field
  ON system_field_sources(field_id);
CREATE INDEX IF NOT EXISTS idx_system_field_sources_tag
  ON system_field_sources(tag_id);
```

## API Contracts

### Internal APIs

```typescript
// src/db/system-fields.ts - New module
const SYSTEM_FIELD_METADATA: Record<string, SystemFieldMetadata>;

function discoverSystemFieldSources(
  docs: TanaDoc[],
  docsById: Map<string, TanaDoc>
): Map<string, Set<string>>;

function insertSystemFieldSources(
  db: Database,
  sources: Map<string, Set<string>>
): void;

// Enhanced SupertagMetadataService method
function getAllFields(tagId: string): InheritedField[];  // Now includes system fields
```

### MCP Response Enhancement

```typescript
// tana_supertag_info response includes system flag
{
  fields: [
    { name: "Date", inferredDataType: "date", system: true },
    { name: "Meeting link", inferredDataType: "url" },
    { name: "Attendees", inferredDataType: "reference", system: true },
  ]
}
```

## Implementation Strategy

### Phase 1: Foundation (Infrastructure)

Core types and database schema for system field tracking.

- [x] T-1.1: Create `src/db/system-fields.ts` with SYSTEM_FIELD_METADATA constant
- [x] T-1.2: Add SystemFieldMetadata type to `src/types/supertag-metadata.ts`
- [x] T-1.3: Create migration for `system_field_sources` table
- [x] T-1.4: Write unit tests for SYSTEM_FIELD_METADATA structure

### Phase 2: Discovery (Data Extraction)

Extract system field source mappings during sync.

- [x] T-2.1: Implement `discoverSystemFieldSources()` function
- [x] T-2.2: Implement `insertSystemFieldSources()` function
- [x] T-2.3: Call discovery during indexer sync (in `indexTagDefs`)
- [x] T-2.4: Write unit tests for discovery logic
- [x] T-2.5: Write integration test with real export data

### Phase 3: Retrieval (Query Enhancement)

Enhance field retrieval to include system fields from ancestors.

- [x] T-3.1: Add `getSystemFieldSourceTags(fieldId)` to SupertagMetadataService
- [x] T-3.2: Add `getSystemFieldsForTag(tagId)` to SupertagMetadataService
- [x] T-3.3: Modify `getAllFields()` to include system fields
- [x] T-3.4: Add `system: boolean` flag to InheritedField type
- [x] T-3.5: Write unit tests for system field retrieval

### Phase 4: Integration (Consumers)

Update MCP tools and CLI to use enhanced field data.

- [x] T-4.1: Update `tana_supertag_info` to include system flag in response
- [x] T-4.2: Update CLI `tags fields` command to show system fields
- [x] T-4.3: Verify `node-builder` works with system fields (should work automatically)
- [x] T-4.4: Write E2E tests for full flow

## File Structure

```
src/
├── db/
│   ├── system-fields.ts          # [New] System field metadata and discovery
│   ├── migrate.ts                # [Modified] Add system_field_sources migration
│   └── indexer.ts                # [Modified] Call discovery during sync
├── types/
│   └── supertag-metadata.ts      # [Modified] Add system flag to field types
├── services/
│   └── supertag-metadata-service.ts  # [Modified] Include system fields in queries
├── mcp/tools/
│   └── supertag-info.ts          # [Modified] Add system flag to response
└── commands/
    └── schema.ts                 # [Modified] Show system fields in CLI

tests/
├── db/
│   └── system-fields.test.ts     # [New] Unit tests for discovery
└── services/
    └── supertag-metadata-service.test.ts  # [Modified] Add system field tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Unknown system field IDs in user workspaces | Medium | Low | Metadata is extensible; unknown SYS_A* fields are ignored |
| Circular inheritance causes infinite loops | High | Low | Existing cycle detection (depth limit) already handles this |
| Performance impact from extra joins | Low | Low | System fields table is small (<10 rows typically) |
| Breaking existing field queries | Medium | Low | Adding optional `system` flag; existing behavior preserved |

## Dependencies

### External

- None (no new npm packages required)

### Internal

- `src/db/indexer.ts` - Sync pipeline entry point
- `src/services/supertag-metadata-service.ts` - Field query service
- `src/mcp/tools/supertag-info.ts` - MCP tool consumer
- `src/services/node-builder.ts` - Node creation consumer

## Migration/Deployment

- [x] **Database migrations needed:** Yes - new `system_field_sources` table
- [ ] **Environment variables:** None
- [ ] **Breaking changes:** None - additive only

Migration runs automatically on first sync after upgrade. Existing schema caches remain valid.

## Estimated Complexity

- **New files:** 1 (`src/db/system-fields.ts`)
- **Modified files:** 6
- **Test files:** 2 (1 new, 1 modified)
- **Estimated tasks:** 18
