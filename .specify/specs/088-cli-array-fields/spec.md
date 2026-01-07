# Spec 088: CLI Array Field Handling

## Problem Statement

The `supertag create` CLI command has poor support for multi-value fields (like Attendees). Current workarounds are brittle:

| Approach | Example | Problem |
|----------|---------|---------|
| Comma-separated | `--attendees "id1,id2,id3"` | Breaks if value contains comma; non-standard |
| Repeated flags | `--attendees id1 --attendees id2` | Only keeps last value (overwrites) |
| JSON input | `--json '{"attendees": ["id1","id2"]}'` | Verbose; requires escaping |

**Root cause:** `parseFieldOptions()` in `create.ts` converts all option values to strings, losing array structure.

## User Journeys

### Journey 1: Add multiple attendees to a meeting
```bash
# Current (brittle)
supertag create meeting "Standup" --attendees "id1,id2,id3"

# Desired (clean)
supertag create meeting "Standup" --attendees id1 id2 id3
# OR
supertag create meeting "Standup" --attendees id1 --attendees id2 --attendees id3
```

### Journey 2: Add multiple tags to a node
```bash
# Desired
supertag create task "Review PR" --tags urgent important
```

## Requirements

### FR-1: Support variadic field options
Fields that accept arrays should support space-separated values:
```bash
--attendees id1 id2 id3
```
Translates to: `{ attendees: ["id1", "id2", "id3"] }`

### FR-2: Support repeated field options
Same field specified multiple times should accumulate:
```bash
--attendees id1 --attendees id2
```
Translates to: `{ attendees: ["id1", "id2"] }`

### FR-3: Maintain backward compatibility
- Comma-separated strings should continue to work (split in `buildFieldNode`)
- JSON input should continue to work
- Single values should work as before

### FR-4: Schema-aware option generation
Use schema metadata to determine which fields are multi-value:
- `dataType: "reference"` fields → variadic
- `dataType: "options"` fields → variadic
- Other fields → single value

## Technical Approach

### Option 1: Dynamic Commander options (Recommended)
Generate Commander options from schema at runtime:
```typescript
// For reference/options fields
program.option('--attendees <ids...>', 'Attendees (space-separated IDs)');

// For single-value fields
program.option('--status <value>', 'Status');
```

**Pros:** Clean UX, proper shell completion, self-documenting
**Cons:** Requires schema loaded before command setup

### Option 2: Generic collector function
Use Commander's collect pattern for all field options:
```typescript
function collect(val: string, acc: string[]) {
  acc.push(val);
  return acc;
}
program.option('--attendees <id>', 'Add attendee', collect, []);
```

**Pros:** Works without schema; repeated flags work naturally
**Cons:** Every flag needs explicit setup; `--attendees id1 id2` won't work

### Option 3: Post-processing in parseFieldOptions
Detect arrays in Commander's parsed options and preserve them:
```typescript
if (Array.isArray(value)) {
  fields[fieldName] = value;
} else {
  fields[fieldName] = String(value);
}
```

**Pros:** Minimal change; works with Commander's built-in array handling
**Cons:** Requires Commander options defined with variadic syntax

## Success Criteria

1. `--attendees id1 id2 id3` creates node with 3 attendee references
2. `--attendees id1 --attendees id2` creates node with 2 attendee references
3. Existing comma-separated syntax continues to work
4. JSON input continues to work
5. Single-value fields unaffected

## Out of Scope

- Auto-completion for node IDs (separate feature)
- Validation that IDs exist (already handled in `buildFieldNode`)
- Interactive picker for references

## Dependencies

- Commander.js variadic options feature
- Schema registry for field type detection

## References

- [Commander.js Variadic Options](https://github.com/tj/commander.js#variadic-option)
- Spec 087: Query Name Contains (related MCP/CLI consistency work)
