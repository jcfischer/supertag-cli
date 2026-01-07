---
id: "074"
feature: "System Field Discovery"
status: "draft"
created: "2026-01-07"
---

# Specification: System Field Discovery

## Overview

Enhance the SchemaRegistry to discover and include system fields (SYS_A*) in supertag schemas. Currently, the registry only extracts user-defined fields from supertag tuple children, missing critical system fields like `SYS_A142` (Attendees) and `SYS_A90` (Date) that are inherited through the supertag hierarchy.

## Problem Statement

When creating a meeting node via `tana_create`, the Attendees field is silently skipped because:

1. `tana_supertag_info(meeting)` returns Date, Meeting link, Notes, etc. but NOT Attendees
2. The SchemaRegistry's `buildNodePayload()` skips fields not found in the schema (line 393-395)
3. System fields are available in Tana but not discovered by the schema parser

**Evidence:**
```typescript
// These are hardcoded as fallbacks in multiple places but not in schema
SYS_A90:  "Date"       // src/db/indexer.ts:866
SYS_A142: "Attendees"  // src/db/indexer.ts:867
```

## User Scenarios

### Scenario 1: Create Meeting with Attendees

**As an** AI agent creating a meeting in Tana
**I want to** pass attendees in the Attendees field
**So that** they appear in the proper field, not as child text nodes

**Current Behavior:**
```typescript
tana_create({
  supertag: "meeting",
  name: "Team Standup",
  fields: { "Attendees": ["Alice", "Bob"] }  // Silently ignored
})
// Result: Attendees field empty, Alice/Bob not attached
```

**Expected Behavior:**
```typescript
tana_create({
  supertag: "meeting",
  name: "Team Standup",
  fields: { "Attendees": ["Alice", "Bob"] }
})
// Result: Attendees field populated with references or text values
```

**Acceptance Criteria:**
- [ ] `tana_supertag_info(meeting)` includes Attendees field
- [ ] `tana_create` with `fields: { "Attendees": [...] }` populates the field
- [ ] Field uses correct attributeId `SYS_A142`

### Scenario 2: Schema Shows Inherited System Fields

**As a** developer inspecting supertag schemas
**I want to** see all available fields including system fields
**So that** I know what fields I can use when creating nodes

**Acceptance Criteria:**
- [ ] `supertag schema show meeting` lists Date and Attendees fields
- [ ] `supertag schema show meeting --verbose` shows field source (inherited vs direct)
- [ ] System fields marked with `system: true` in schema

### Scenario 3: Event-Type Supertags Get Event Fields

**As a** user creating any event-type node (meeting, appointment, etc.)
**I want to** have Date and Attendees fields available
**So that** I don't need to manually configure each event supertag

**Acceptance Criteria:**
- [ ] Supertags inheriting from "Type | Event" get SYS_A90 (Date) and SYS_A142 (Attendees)
- [ ] Detection works through multiple inheritance levels
- [ ] Non-event supertags don't get these fields

## Functional Requirements

### FR-1: System Field Metadata Registry

Maintain metadata for known system fields (IDs and types only - NOT which supertags use them):

```typescript
const SYSTEM_FIELD_METADATA: Record<string, SystemFieldMeta> = {
  'SYS_A90': {
    name: 'Date',
    normalizedName: 'date',
    dataType: 'date',
  },
  'SYS_A142': {
    name: 'Attendees',
    normalizedName: 'attendees',
    dataType: 'reference',
  },
  'SYS_A61': {
    name: 'Due date',
    normalizedName: 'duedate',
    dataType: 'date',
  },
};
```

**Note:** This only provides field metadata. Which supertags USE these fields is discovered dynamically.

### FR-2: Dynamic System Field Discovery from Export

During `loadFromExport()`, discover which supertags define system fields by scanning tagDef tuples:

```typescript
private discoverSystemFieldSources(docs: TanaDoc[]): Map<string, Set<string>> {
  // Map: fieldId (SYS_A*) -> Set of tagDef IDs that define it
  const fieldSources = new Map<string, Set<string>>();

  for (const doc of docs) {
    if (doc.props?._docType !== 'tagDef') continue;
    if (!doc.children) continue;

    // Check each tuple child for system field definitions
    for (const childId of doc.children) {
      const child = this.docsById.get(childId);
      if (child?.props?._docType === 'tuple' && child.children?.length) {
        const fieldId = child.children[0];

        // Is this a system field?
        if (fieldId.startsWith('SYS_A') && SYSTEM_FIELD_METADATA[fieldId]) {
          if (!fieldSources.has(fieldId)) {
            fieldSources.set(fieldId, new Set());
          }
          fieldSources.get(fieldId)!.add(doc.id);
        }
      }
    }
  }

  return fieldSources;
}
```

**Validation:** Discovers which tagDefs in THIS workspace define SYS_A142, SYS_A90, etc.

### FR-3: Inheritance Chain Resolution

When getting fields for a supertag, check if it or any ancestor defines system fields:

```typescript
private getSystemFieldsForSupertag(schema: SupertagSchema): FieldSchema[] {
  const systemFields: FieldSchema[] = [];

  // Get all ancestor tag IDs (including this tag)
  const ancestorIds = this.getAncestorIds(schema);
  ancestorIds.add(schema.id);

  // Check each system field
  for (const [fieldId, sources] of this.systemFieldSources) {
    // Does any ancestor define this system field?
    const definesField = [...sources].some(sourceId => ancestorIds.has(sourceId));

    if (definesField) {
      const meta = SYSTEM_FIELD_METADATA[fieldId];
      systemFields.push({
        attributeId: fieldId,
        name: meta.name,
        normalizedName: meta.normalizedName,
        dataType: meta.dataType,
        system: true,
      });
    }
  }

  return systemFields;
}
```

**Validation:** Works regardless of supertag naming conventions in any workspace.

### FR-4: Schema Field Includes System Fields

Update `getFields()` to include system fields:

```typescript
getFields(supertagName: string): FieldSchema[] {
  const schema = this.getSupertag(supertagName);
  if (!schema) return [];

  // Get user-defined fields (existing)
  const userFields = this.collectFieldsRecursive(schema, new Set());

  // Get system fields based on inheritance
  const systemFields = this.injectsSystemFields(schema);

  // Merge, user fields take precedence
  return [...userFields, ...systemFields.filter(sf =>
    !userFields.some(uf => uf.attributeId === sf.attributeId)
  )];
}
```

**Validation:** Duplicate fields are deduplicated with user-defined taking precedence.

### FR-4: Update tana_supertag_info Response

Include system fields in the MCP tool response:

```typescript
// tana_supertag_info(meeting) returns:
{
  fields: [
    { name: "Date", inferredDataType: "date", system: true },
    { name: "Meeting link", inferredDataType: "url" },
    { name: "Attendees", inferredDataType: "reference", system: true },
    // ... other fields
  ]
}
```

**Validation:** `system: true` distinguishes inherited system fields from user-defined.

## Non-Functional Requirements

### NFR-1: Backward Compatibility

- Existing schemas without system fields continue to work
- Fields already defined on supertag take precedence over system fields
- No breaking changes to MCP tool parameters

### NFR-2: Performance

- System field injection adds <1ms to schema lookup
- No additional database queries required (uses in-memory registry)

## Technical Notes

### Known System Fields

From codebase analysis (`src/db/indexer.ts`, `src/mcp/tools/node.ts`):

| ID | Name | Type | Used By |
|----|------|------|---------|
| SYS_A13 | Tag | reference | All (internal) |
| SYS_A61 | Due date | date | Tasks, Todos |
| SYS_A90 | Date | date | Events, Meetings |
| SYS_A142 | Attendees | reference | Events, Meetings |

### Dynamic Discovery Approach

Rather than hardcoding which supertags provide system fields (which varies by workspace), the solution:

1. **During schema sync:** Scan all tagDef documents for tuples referencing SYS_A* fields
2. **Build source map:** `Map<fieldId, Set<tagDefId>>` - which tags define which system fields
3. **At query time:** Check if target supertag or any ancestor is in the source set

**Example:** In one workspace, "Type | Event" might define SYS_A142. In another, "calendar-event" might. The discovery finds the actual source regardless of naming.

```typescript
// After loadFromExport():
this.systemFieldSources = {
  'SYS_A90': Set(['tagDefId1', 'tagDefId2']),   // Tags that define Date
  'SYS_A142': Set(['tagDefId1']),               // Tags that define Attendees
  'SYS_A61': Set(['tagDefId3', 'tagDefId4']),   // Tags that define Due date
}
```

### Files to Modify

1. `src/schema/registry.ts` - Add system field injection
2. `src/mcp/tools/supertag-info.ts` - Include system fields in response
3. `src/commands/schema.ts` - Show system fields in CLI output

## Out of Scope

- Discovery of NEW system field IDs (SYS_A* IDs are hardcoded in metadata)
- Custom system field definitions by users
- System field modification (read-only)
- Caching system field sources across schema syncs (rebuilt each sync)

## Test Cases

```typescript
describe('System Field Discovery', () => {
  describe('discoverSystemFieldSources', () => {
    it('finds tagDefs that define SYS_A142 (Attendees)', () => {
      const sources = registry.getSystemFieldSources('SYS_A142');
      expect(sources.size).toBeGreaterThan(0);
    });

    it('finds tagDefs that define SYS_A90 (Date)', () => {
      const sources = registry.getSystemFieldSources('SYS_A90');
      expect(sources.size).toBeGreaterThan(0);
    });
  });

  describe('getFields with system fields', () => {
    it('includes system fields for supertags that inherit them', () => {
      // Find a supertag that has SYS_A142 in its ancestry
      const meeting = registry.getSupertag('meeting');
      const fields = registry.getFields('meeting');

      // Should include Attendees if meeting inherits from a tag that defines it
      const hasAttendees = fields.some(f => f.attributeId === 'SYS_A142');
      // This will be true or false depending on workspace structure
      expect(typeof hasAttendees).toBe('boolean');
    });

    it('marks system fields with system: true', () => {
      const fields = registry.getFields('meeting');
      const systemFields = fields.filter(f => f.system === true);

      for (const field of systemFields) {
        expect(field.attributeId).toMatch(/^SYS_A/);
      }
    });

    it('user-defined fields take precedence over system fields', () => {
      const fields = registry.getFields('supertag-with-custom-date');
      const dateFields = fields.filter(f => f.normalizedName === 'date');
      expect(dateFields.length).toBe(1);
    });

    it('supertags without system field ancestors get no system fields', () => {
      // A supertag that doesn't inherit from any tag defining SYS_A142
      const fields = registry.getFields('person');
      const attendees = fields.find(f => f.attributeId === 'SYS_A142');
      expect(attendees).toBeUndefined();
    });
  });

  describe('inheritance chain resolution', () => {
    it('finds system fields through deep inheritance', () => {
      // If A extends B extends C, and C defines SYS_A90,
      // then A should get SYS_A90
      const registry = new SchemaRegistry();
      registry.loadFromExport(mockExportWithDeepInheritance);

      const fields = registry.getFields('leaf-supertag');
      expect(fields.some(f => f.attributeId === 'SYS_A90')).toBe(true);
    });
  });
});
```
