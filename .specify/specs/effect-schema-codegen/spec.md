# Spec: Effect Schema Codegen from Supertags

**Status**: Completed
**Author**: PAI
**Date**: 2025-12-28
**Completed**: 2025-12-28
**Priority**: Medium

## Summary

Generate Effect Schema class definitions from Tana supertag definitions. Similar to [Gel's interfaces generator](https://docs.geldata.com/reference/using/js/interfaces), this feature introspects supertag schemas and generates type-safe [Effect Schema classes](https://effect.website/docs/schema/classes/) that provide both TypeScript types and runtime validation.

## Problem Statement

Users who build applications on top of Tana data need type-safe schemas for their supertags. Currently, they must manually:

1. Inspect supertag definitions in Tana
2. Manually write corresponding TypeScript types
3. Manually write validation schemas (Zod, Effect, etc.)
4. Keep these in sync when supertag definitions change

This is error-prone, tedious, and doesn't scale.

## Proposed Solution

Add a `supertag codegen` command that:

1. Reads supertag definitions from the indexed database
2. Generates Effect Schema class definitions with proper field types
3. Outputs TypeScript files that can be imported into user applications

### Example Output

Given a Tana supertag:

```
#TodoItem
  - Title (text)
  - Due Date (date)
  - Priority (options: High, Medium, Low)
  - Completed (checkbox)
  - Assignee (reference: #Person)
```

Generate:

```typescript
import { Schema } from "effect"

// Generated from Tana supertag: TodoItem
// Last synced: 2025-12-28T10:30:00Z
// Supertag ID: abc123xyz

export class TodoItem extends Schema.Class<TodoItem>("TodoItem")({
  /** Tana node ID */
  id: Schema.String,

  /** Node name/title */
  title: Schema.String,

  /** Due Date field */
  dueDate: Schema.optionalWith(Schema.DateFromString, { as: "Option" }),

  /** Priority field - options: High, Medium, Low */
  priority: Schema.optionalWith(
    Schema.Union(
      Schema.Literal("High"),
      Schema.Literal("Medium"),
      Schema.Literal("Low")
    ),
    { as: "Option" }
  ),

  /** Completed field */
  completed: Schema.optionalWith(Schema.Boolean, { as: "Option" }),

  /** Assignee field - reference to Person */
  assignee: Schema.optionalWith(Schema.String, { as: "Option" }),
}) {}
```

## Technical Design

### CLI Interface

```bash
# Generate schemas for all supertags
supertag codegen --output ./generated/schemas.ts

# Generate for specific supertags
supertag codegen --tags "TodoItem,Person,Project" --output ./generated/

# Generate with options
supertag codegen \
  --output ./generated/ \
  --format effect           # effect | zod | typescript (future)
  --include-metadata        # Include sync timestamp, tag ID in comments
  --optional-strategy option # option | undefined | nullable
  --naming camelCase        # camelCase | PascalCase | snake_case
  --extends                 # Include inherited fields from parent tags
```

### Type Mapping

| Tana DataType | Effect Schema | Notes |
|---------------|---------------|-------|
| `text` | `Schema.String` | Default type |
| `number` | `Schema.Number` | |
| `date` | `Schema.DateFromString` | ISO 8601 format |
| `checkbox` | `Schema.Boolean` | |
| `url` | `Schema.String.pipe(Schema.pattern(/^https?:\/\//))` | With URL validation |
| `email` | `Schema.String.pipe(Schema.pattern(emailRegex))` | With email validation |
| `reference` | `Schema.String` | Node ID; optionally branded type |
| `options` | `Schema.Union(Schema.Literal(...))` | When options are known |

### Architecture

```
src/codegen/
├── index.ts              # Main codegen entry point
├── effect-generator.ts   # Effect Schema generator
├── type-mapper.ts        # DataType → Schema mapping
├── template.ts           # Code template utilities
├── naming.ts             # Field name normalization
└── types.ts              # Codegen-specific types

CLI command:
src/commands/codegen.ts   # Commander.js command definition
```

### Data Flow

1. **Input**: Read from `UnifiedSchemaService` (already exists)
   ```typescript
   const service = new UnifiedSchemaService(db)
   const supertags = service.listSupertags()
   ```

2. **Enrichment**: Resolve inheritance via `getInheritedFields()`
   ```typescript
   for (const tag of supertags) {
     tag.allFields = service.getInheritedFields(tag.id)
   }
   ```

3. **Mapping**: Convert DataType to Effect Schema
   ```typescript
   const schemaType = mapDataTypeToEffect(field.dataType)
   ```

4. **Generation**: Template-based TypeScript output
   ```typescript
   const code = generateEffectClass(supertag, fields)
   ```

5. **Output**: Write to file(s)

### File Organization Options

**Single file mode** (default):
```
generated/schemas.ts    # All schemas in one file
```

**Multi-file mode** (`--split`):
```
generated/
├── index.ts           # Re-exports all schemas
├── TodoItem.ts
├── Person.ts
└── Project.ts
```

## Edge Cases & Considerations

### 1. Optional Fields
All Tana fields are optional by nature (a node may not have values for all fields). The `--optional-strategy` flag controls representation:

- `option`: Use Effect's `Option` type (recommended for Effect apps)
- `undefined`: Use `T | undefined`
- `nullable`: Use `T | null`

### 2. Reference Fields
References could be:
- Simple string (node ID)
- Branded type: `Schema.String.pipe(Schema.brand("TanaNodeId"))`
- Type-safe reference: When target supertag is known, could link types

### 3. Inheritance
When a supertag extends another:
- Include inherited fields
- Use Effect's `Schema.Class.extend()` pattern
- Document field source in comments

### 4. Field Name Conflicts
Normalize field names to valid TypeScript identifiers:
- `Due Date` → `dueDate`
- `Is Active?` → `isActive`
- `123-field` → `_123Field`

### 5. Options Type
When field has inline options (e.g., Priority: High/Medium/Low):
- Extract options from field values in database
- Generate `Schema.Union(Schema.Literal("High"), ...)`

### 6. Multi-Value Fields
Tana fields can have multiple values:
- Generate `Schema.Array(Schema.String)` when detected
- Add `--multi-value array` or `--multi-value first` flag

## Dependencies

- **Effect**: `effect` package (user must have installed)
- **Existing services**: `UnifiedSchemaService`, `SupertagMetadataService`

## Testing Strategy

1. **Unit tests**: Type mapping, naming normalization
2. **Snapshot tests**: Generated code matches expected output
3. **Integration tests**: Generated schemas validate real Tana data

## Success Criteria

- [ ] Generate valid TypeScript that compiles without errors
- [ ] Generated Effect schemas correctly validate Tana node data
- [ ] Support all 8 Tana DataTypes
- [ ] Handle inheritance correctly
- [ ] Field names are valid TypeScript identifiers
- [ ] Comments include supertag ID and sync timestamp
- [ ] Tests cover all edge cases

## Future Enhancements

1. **Zod generator**: Add `--format zod` option
2. **Plain TypeScript**: Add `--format typescript` for interfaces only
3. **Watch mode**: Regenerate on database changes
4. **Validation helpers**: Generate helper functions for creating nodes
5. **MCP tool**: Expose codegen via MCP for AI-assisted development

## References

- [Effect Schema Classes](https://effect.website/docs/schema/classes/)
- [Gel Interfaces Generator](https://docs.geldata.com/reference/using/js/interfaces)
- Existing supertag services: `src/services/unified-schema-service.ts`
- DataType enum: `src/utils/infer-data-type.ts`
