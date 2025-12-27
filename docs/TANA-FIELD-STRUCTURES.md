# Tana Field Structures - Technical Reference

This document explains how Tana stores field values in JSON exports and how supertag-cli extracts and indexes them.

## Overview

Tana uses **tuple nodes** to store field values. A tuple is a special node type that associates a field label with one or more values. However, Tana has **multiple patterns** for storing fields, which affects extraction.

## Tuple Structure Basics

In the Tana JSON export, a tuple node has:

```json
{
  "id": "tupleId123",
  "props": {
    "_docType": "tuple",
    "_sourceId": "fieldDefId456",  // Optional! May be missing
    "created": 1734912000000
  },
  "children": ["labelNodeId", "valueNodeId1", "valueNodeId2"]
}
```

- `_docType: "tuple"` - Identifies this as a tuple node
- `_sourceId` - Points to field definition (but often missing!)
- `children[0]` - The field label node (contains field name)
- `children[1..n]` - The value nodes

## Supertag Field Definitions

Supertags define their available fields via tuple children in the `tagDef` node. This allows programmatic discovery of what fields a supertag supports.

### tagDef Structure

```
tagDef Node (e.g., "bp-room", docType: tagDef)
├── Tuple → [Field Label 1, Default Value/Type]
├── Tuple → [Field Label 2, Default Value/Type]
├── Tuple → [Field Label 3, Default Value/Type]
└── Tuple → [Field Label 4, Default Value/Type]
```

**JSON Example** (bp-room supertag):
```json
{
  "id": "Z_v99lD3unaM",
  "props": {
    "name": "bp-room",
    "_docType": "tagDef",
    "_ownerId": "M9rkJkwuED_SCHEMA",
    "_metaNodeId": "YApky-frxwQp"
  },
  "children": ["XmhnXMn-o3wE", "ITrHZ6Ju4KV8", "Wwo8zpV-IyS7", "hgMAbxdD-ToP"]
}

// Each child is a tuple defining a field:
{
  "id": "XmhnXMn-o3wE",
  "props": { "_docType": "tuple" },
  "children": ["lgbiqgS2DEhx", "nzDfdJZfLaLM"]  // [label, default]
}

// First child of tuple = field label name:
{
  "id": "lgbiqgS2DEhx",
  "props": { "name": "Word Paintings" }
}
```

### Field Discovery Pattern

To discover what fields a supertag has:

1. Find the tagDef node by name
2. Get its tuple children
3. For each tuple, first child's `name` = field name

**SQL Query:**
```sql
-- Find all fields for a supertag
SELECT
  t.name as supertag,
  label.name as field_name
FROM nodes t
JOIN nodes tuple ON tuple.parent_id = t.id
JOIN nodes label ON label.parent_id = tuple.id
WHERE t.name = 'bp-room'
  AND json_extract(t.raw_data, '$.props._docType') = 'tagDef'
  AND json_extract(tuple.raw_data, '$.props._docType') = 'tuple'
  AND label.id = json_extract(tuple.raw_data, '$.children[0]');
```

**Example Result** (bp-room):

| Field Name | Value Count | Sample Values |
|------------|-------------|---------------|
| Room Number | 1 | 25 |
| Chess Piece | 24 | White Pawn, Rook |
| Word Paintings | 25 | Paint - Pint, Crow - Row |
| Items | 82 | Puzzle Box, Passport |

### Supertag Inheritance

Supertags can inherit from other supertags. Inheritance is stored in the **metaNode** (referenced by `_metaNodeId`), not in the tagDef itself.

**Structure:**
```
tagDef (e.g., outcome-goal)
└── _metaNodeId → metaNode
    └── Tuple (extends definition)
        ├── SYS_A13              ← "extends" attribute marker
        ├── SYS_T01              ← type marker (optional)
        ├── parentTagDefId1      → first parent supertag
        └── parentTagDefId2      → second parent supertag
```

**Example** (outcome-goal inherits from goal-base and Stream | Objectives):
```json
// outcome-goal tagDef
{
  "id": "_yIO69zflh",
  "props": {
    "name": "outcome-goal",
    "_metaNodeId": "-G7Z83qniS",  // Points to metaNode
    "_docType": "tagDef"
  }
}

// metaNode contains inheritance tuple
{
  "id": "-G7Z83qniS",
  "children": ["NfC1LZ1pWW", "uLP6_4QPMP"]
}

// Inheritance tuple
{
  "id": "NfC1LZ1pWW",
  "props": { "_docType": "tuple" },
  "children": [
    "SYS_A13",        // extends marker
    "SYS_T01",        // type marker
    "edQ5Wvciik",     // → goal-base
    "NbAAALwcJzlw"    // → Stream | Objectives
  ]
}
```

**SQL Query to find supertag inheritance:**
```sql
-- Find parent supertags for a given tagDef
SELECT parent.name as parent_supertag, parent.id
FROM nodes tagdef
JOIN nodes meta ON meta.id = json_extract(tagdef.raw_data, '$.props._metaNodeId')
JOIN nodes tuple ON tuple.parent_id = meta.id
JOIN nodes parent ON json_extract(tuple.raw_data, '$.children') LIKE '%' || parent.id || '%'
WHERE tagdef.name = 'outcome-goal'
  AND json_extract(tagdef.raw_data, '$.props._docType') = 'tagDef'
  AND json_extract(tuple.raw_data, '$.props._docType') = 'tuple'
  AND json_extract(parent.raw_data, '$.props._docType') = 'tagDef';
```

**Inheritance Implications:**
- Child supertags inherit fields from parent supertags
- A node tagged with `#outcome-goal` effectively has fields from `#goal-base` and `#Stream | Objectives`
- Field values may be stored at any level of the inheritance hierarchy

### Complex Inheritance Example: meeting

The `meeting` supertag demonstrates deep, multi-level inheritance:

```
meeting (WcNfAKD2JI)
└── extends: Stream | Professional (BpyXUrxqwJ3Q)
    ├── extends: Function | Vault Save (L6NDbyp1VMQD) ← ROOT
    ├── extends: Auto save | Archive (J-DoMrG36Yy_) ← ROOT
    └── extends: Type | Event (2Ux7TUEjN4yt)
        ├── extends: Source | Origin (ACFKdj7z3eLq) ← ROOT
        └── extends: Links to | Focus (n-VNsslg7LZ2)
            └── extends: Links to | Origin (F10prPAGWVjo) ← ROOT
```

**Flattened inheritance (all 8 supertags):**

| Level | Supertag | Purpose (inferred) |
|-------|----------|-------------------|
| 0 | meeting | The actual meeting supertag |
| 1 | Stream \| Professional | Professional/work stream categorization |
| 2 | Function \| Vault Save | Auto-save to vault functionality |
| 2 | Auto save \| Archive | Archive behavior |
| 2 | Type \| Event | Event-type classification |
| 3 | Source \| Origin | Source tracking |
| 3 | Links to \| Focus | Focus linking behavior |
| 4 | Links to \| Origin | Origin linking |

This explains why meetings have features like auto-archiving, vault saving, event properties, and focus linking - they're all inherited behaviors from parent supertags.

### Recursive Inheritance Discovery

To find the complete inheritance chain, recursively follow:

1. Get tagDef's `_metaNodeId`
2. Find tuple child with `SYS_A13` in children array
3. Extract tagDef IDs (skip SYS_* markers)
4. For each parent tagDef, repeat from step 1

**Bash script to trace inheritance:**
```bash
trace_inheritance() {
  local tag_id="$1"
  local indent="${2:-}"

  local name=$(sqlite3 "$DB" "SELECT name FROM nodes WHERE id = '$tag_id';")
  local meta_id=$(sqlite3 "$DB" "SELECT json_extract(raw_data, '$.props._metaNodeId') FROM nodes WHERE id = '$tag_id';")

  echo "${indent}$name ($tag_id)"

  if [ -n "$meta_id" ]; then
    local extends=$(sqlite3 "$DB" "
      SELECT json_extract(raw_data, '$.children')
      FROM nodes
      WHERE parent_id = '$meta_id'
      AND json_extract(raw_data, '$.props._docType') = 'tuple'
      AND json_extract(raw_data, '$.children') LIKE '%SYS_A13%';
    ")

    # Parse parent IDs (skip SYS_* entries)
    echo "$extends" | tr -d '[]"' | tr ',' '\n' | while read parent_id; do
      if [[ ! "$parent_id" =~ ^SYS_ ]] && [ -n "$parent_id" ]; then
        trace_inheritance "$parent_id" "${indent}  "
      fi
    done
  fi
}

DB=~/.local/share/supertag/workspaces/main/tana-index.db
trace_inheritance "WcNfAKD2JI"  # meeting
```

### Proposed Enhancements

**1. Show supertag fields:**
```bash
supertag tags fields bp-room
# Output:
# Field Name       Count
# Room Number      1
# Chess Piece      24
# Word Paintings   25
# Items            82
```

**2. Show supertag inheritance:**
```bash
supertag tags show outcome-goal --inheritance
# Output:
# outcome-goal
#   extends: goal-base
#   extends: Stream | Objectives
#   fields: Macrocycle, Value Goal, Term, Status, ...
```

---

## Field Type Definitions

Each field definition (attrDef) can have a **type specification** stored in a `typeChoice` child tuple. This allows supertag-cli to determine the exact field type from Tana's internal representation.

### typeChoice Structure

```
attrDef Node (e.g., "Due date", docType: attrDef)
└── typeChoice Tuple (_sourceId: SYS_A02, name: "typeChoice")
    ├── SYS_T06           ← type marker (always present)
    └── SYS_D03           ← field type code (date in this case)
```

**JSON Example** (Date field):
```json
{
  "id": "LUBR1psF86XL",
  "props": {
    "name": "Due date",
    "_docType": "attrDef"
  },
  "children": ["VGrcCAv5NTy8"]
}

{
  "id": "VGrcCAv5NTy8",
  "props": {
    "_sourceId": "SYS_A02",
    "name": "typeChoice"
  },
  "children": ["SYS_T06", "SYS_D03"]
}
```

### SYS_D* Type Codes

Tana encodes field types using system reference codes:

| SYS_D Code | Field Type | Description |
|------------|------------|-------------|
| SYS_D01 | checkbox | Boolean/checkbox field |
| SYS_D03 | date | Date field (calendar picker) |
| SYS_D05 | reference | Options from Supertag (reference to tagged items) |
| SYS_D06 | text | Plain text field |
| SYS_D08 | number | Numeric field |
| SYS_D10 | url | URL field (clickable link) |
| SYS_D11 | email | Email field |
| SYS_D12 | options | Inline options (dropdown) |
| SYS_D13 | reference | Tana User (team member assignment) |

### Type Extraction Logic

To determine a field's type:

1. Find the field definition (attrDef) node
2. Look for a child with `_sourceId: "SYS_A02"` and `name: "typeChoice"`
3. In the typeChoice's children, find the SYS_D* code (ignoring SYS_T06)
4. Map the SYS_D* code to the field type

**SQL Query**:
```sql
-- Find field types from typeChoice structure
SELECT
  attrdef.id,
  json_extract(attrdef.raw_data, '$.props.name') as field_name,
  tc.children
FROM nodes attrdef
JOIN nodes tc ON tc.id IN (
  SELECT value FROM json_each(json_extract(attrdef.raw_data, '$.children'))
)
WHERE json_extract(tc.raw_data, '$.props._sourceId') = 'SYS_A02'
  AND json_extract(tc.raw_data, '$.props.name') = 'typeChoice';
```

### Type Extraction in supertag-cli

The `extractFieldTypesFromDocs()` function in `src/db/explicit-type-extraction.ts`:

1. Builds a parent lookup map for all nodes
2. Finds all typeChoice tuples (`_sourceId: "SYS_A02"`, `name: "typeChoice"`)
3. Extracts the SYS_D* code from each typeChoice's children
4. Maps the parent (attrDef) ID to the detected DataType
5. Updates `inferred_data_type` in the `supertag_fields` table

**Priority Order** for field type detection:
1. **Explicit type** from typeChoice structure (most reliable)
2. **Value-based inference** from actual field values
3. **Name-based heuristics** as fallback

**Code Reference**: `src/db/explicit-type-extraction.ts`

---

## Pattern 1: Standard Field Tuples

**Structure**: Parent node contains tuple as child, tuple contains label + values

```
Parent Node (e.g., "Meeting Notes")
└── Tuple (docType: tuple)
    ├── Label Node (name: "Summary")
    └── Value Node (name: "Key discussion points...")
```

**JSON Example**:
```json
{
  "id": "parent123",
  "props": { "name": "Meeting Notes" },
  "children": ["tuple456"]
}

{
  "id": "tuple456",
  "props": { "_docType": "tuple", "_sourceId": "summaryDef" },
  "children": ["label789", "value012"]
}

{
  "id": "label789",
  "props": { "name": "Summary" }
}

{
  "id": "value012",
  "props": { "name": "Key discussion points from the meeting" }
}
```

**Extraction**: ✅ Fully supported by `isFieldTuple()` and `extractFieldValuesFromNodes()`

### With vs Without `_sourceId`

Many tuples **do not have `_sourceId`** set. This was discovered during investigation:

| Type | Count (example workspace) |
|------|---------------------------|
| Tuples WITH `_sourceId` | 44,623 |
| Tuples WITHOUT `_sourceId` | 368,997 |

Both patterns use the same structure (label as first child, values as subsequent children). The `isFieldTuple()` function handles both.

## Pattern 2: Mega-Tuple Flat Structure (Daily Briefings)

**Structure**: A single tuple contains hundreds of children in a flat list, with field relationships encoded via indentation in node names.

```
Mega-Tuple (docType: tuple, 100-1000 children)
├── "Today is 2025-06-09 - Monday"
├── "Here's some context for today:"
├── "- Today, Mon, 9 Jun #day"
├── "  - Gestern war gut weil:"          ← Field label (2 spaces + "- ")
├── "    - Had a productive day"          ← Field value (4 spaces + "- ")
├── "  - Meetings:"                       ← Another field label
├── "    - Team standup"                  ← Meeting value
└── ... (hundreds more)
```

**Key Characteristics**:
- Parent tuple has 50+ children (up to 1000+)
- Field labels have `"  - "` prefix and `:` suffix
- Values have `"    - "` prefix (more indentation)
- Labels and values are **siblings**, not parent-child
- The indentation IS in the original JSON `name` field

**JSON Example**:
```json
{
  "id": "megaTuple123",
  "props": { "_docType": "tuple" },
  "children": ["intro1", "intro2", "fieldLabel1", "value1", "fieldLabel2", "value2", ...]
}

{
  "id": "fieldLabel1",
  "props": { "name": "  - Gestern war gut weil:" }
}

{
  "id": "value1",
  "props": { "name": "    - Had a productive coding session" }
}
```

**Extraction**: ❌ Not currently extracted (skipped by 50+ children check)

### Why This Pattern Exists

This appears to be how Tana's daily briefing/AI features store structured daily entries. The flat structure allows:
- Easy reordering of entries
- Flexible nesting via indentation
- Compact storage in a single tuple

## Pattern 3: Orphaned Field Labels

Some field labels exist without parent nodes:

```json
{
  "id": "orphan123",
  "props": { "name": "Gestern war gut weil:" }
  // No parent_id, children may or may not exist
}
```

These are typically:
- Deleted nodes where parent was removed
- Template definitions
- Search result artifacts

**Extraction**: ❌ Not extracted (no parent context)

## Database Schema

### `field_values` Table

```sql
CREATE TABLE field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tuple_id TEXT NOT NULL,      -- The tuple node ID
  parent_id TEXT NOT NULL,     -- The parent of the tuple (actual content node)
  field_def_id TEXT,           -- _sourceId if present, empty string if not
  field_name TEXT NOT NULL,    -- Human-readable field name from label node
  value_node_id TEXT NOT NULL, -- The value node ID
  value_text TEXT NOT NULL,    -- The actual value text
  value_order INTEGER DEFAULT 0,
  created INTEGER              -- Timestamp from parent node
);

CREATE VIRTUAL TABLE field_values_fts USING fts5(
  value_text,
  content='field_values',
  content_rowid='id'
);
```

### Extraction Flow

```
JSON Export
    │
    ▼
Parse nodes into Map<string, NodeDump>
    │
    ▼
Build parentMap (child → parent) for O(1) lookups
    │
    ▼
For each node:
    │
    ├── Is it a tuple? (props._docType === "tuple")
    │   │
    │   ├── Has 2+ children?
    │   │   │
    │   │   ├── Has 50+ children? → SKIP (mega-tuple)
    │   │   │
    │   │   └── First child has valid name?
    │   │       │
    │   │       ├── Name starts with "  - "? → SKIP (flat structure)
    │   │       │
    │   │       └── Extract field name from label
    │   │           Extract values from children[1..n]
    │   │           Find parent via parentMap
    │   │           Insert into field_values
    │   │
    │   └── Less than 2 children → SKIP
    │
    └── Not a tuple → SKIP
```

## Field Statistics (Example Workspace)

| Field Name | Count | Notes |
|------------|-------|-------|
| ⚙️ Vault | 4,713 | System field |
| Transcript | 2,560 | Meeting transcripts |
| Notes | 2,453 | General notes |
| Location | 2,305 | Event locations |
| Summary | 1,729 | Meeting summaries |
| Todo Status | 1,444 | Task status |
| Gestern war gut weil | 2 | Daily reflection (most in mega-tuples) |

## Code References

| File | Purpose |
|------|---------|
| `src/db/field-values.ts` | Field extraction functions |
| `src/db/indexer.ts:687` | Calls extraction during indexing |
| `tests/db/field-values-performance.test.ts` | Tests for extraction |
| `src/commands/tags.ts` | Tag commands (future: `tags fields` subcommand) |

### Key Functions

```typescript
// Check if node is a valid field tuple
isFieldTuple(node: NodeDump, nodes: Map<string, NodeDump>): boolean

// Extract field values from all nodes
extractFieldValuesFromNodes(
  nodes: Map<string, NodeDump>,
  db: Database,
  options: { parentMap?: Map<string, string> }
): ExtractedFieldValue[]

// Resolve field name from tuple's first child
resolveFieldNameFromTuple(tuple: NodeDump, nodes: Map<string, NodeDump>): string | null
```

## Future Enhancement: Mega-Tuple Extraction

To extract fields from mega-tuples, a new function would need to:

1. Identify mega-tuples (50+ children)
2. Scan children for indentation patterns:
   - `"  - FieldName:"` → field label
   - `"    - Value"` → field value (associated with previous label)
3. Build label→value relationships from sequential siblings
4. Strip indentation prefixes from extracted values

**Challenges**:
- Determining which values belong to which label
- Handling nested indentation levels
- Performance with tuples containing 1000+ children

## Troubleshooting

### "Field not found in field_values"

Check if the field uses mega-tuple structure:
```sql
SELECT n.name, p.id,
  (SELECT COUNT(*) FROM json_each(json_extract(p.raw_data, '$.children'))) as child_count
FROM nodes n
JOIN nodes p ON n.parent_id = p.id
WHERE n.name LIKE '%FieldName%'
AND json_extract(p.raw_data, '$.props._docType') = 'tuple';
```

If `child_count > 50`, the field is in a mega-tuple.

### "Low field value count"

Run statistics:
```sql
-- Count by extraction pattern
SELECT
  CASE
    WHEN json_extract(raw_data, '$.props._sourceId') IS NOT NULL THEN 'with_sourceId'
    ELSE 'without_sourceId'
  END as type,
  COUNT(*) as count
FROM nodes
WHERE json_extract(raw_data, '$.props._docType') = 'tuple'
GROUP BY type;
```

## References

- [Field Values Documentation](./fields.md) - User-facing docs
- [Embeddings Documentation](./embeddings.md) - Field context in embeddings
- Tana Export Format - Internal Tana documentation (if available)
