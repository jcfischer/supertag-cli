/**
 * SQLite Schema for Tana Index
 *
 * Drizzle ORM schema definitions for storing parsed Tana data
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Nodes table - All Tana nodes with metadata
 */
export const nodes = sqliteTable(
  "nodes",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    parentId: text("parent_id"),
    nodeType: text("node_type"), // 'node', 'supertag', 'field', 'trash'
    created: integer("created"),
    updated: integer("updated"),
    doneAt: integer("done_at"), // Completion timestamp from props._done
    rawData: text("raw_data"), // JSON stringified NodeDump
  },
  (table) => ({
    parentIdx: index("idx_nodes_parent").on(table.parentId),
    typeIdx: index("idx_nodes_type").on(table.nodeType),
    nameIdx: index("idx_nodes_name").on(table.name),
    doneAtIdx: index("idx_nodes_done_at").on(table.doneAt),
  })
);

/**
 * Supertags table - Detected supertags with metadata
 */
export const supertags = sqliteTable(
  "supertags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nodeId: text("node_id").notNull(),
    tagName: text("tag_name").notNull(),
    tagId: text("tag_id").notNull(),
    color: text("color"),
  },
  (table) => ({
    nodeIdx: index("idx_supertags_node").on(table.nodeId),
    nameIdx: index("idx_supertags_name").on(table.tagName),
    tagIdIdx: index("idx_supertags_tagid").on(table.tagId),
  })
);

/**
 * Fields table - Field definitions and values
 */
export const fields = sqliteTable(
  "fields",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nodeId: text("node_id").notNull(),
    fieldName: text("field_name").notNull(),
    fieldId: text("field_id").notNull(),
  },
  (table) => ({
    nodeIdx: index("idx_fields_node").on(table.nodeId),
    nameIdx: index("idx_fields_name").on(table.fieldName),
    fieldIdIdx: index("idx_fields_fieldid").on(table.fieldId),
  })
);

/**
 * References table - Node relationships (inline refs, parent-child, etc)
 */
export const references = sqliteTable(
  "references",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromNode: text("from_node").notNull(),
    toNode: text("to_node").notNull(),
    referenceType: text("reference_type").notNull(), // 'inline_ref', 'parent', 'child'
  },
  (table) => ({
    fromIdx: index("idx_references_from").on(table.fromNode),
    toIdx: index("idx_references_to").on(table.toNode),
    typeIdx: index("idx_references_type").on(table.referenceType),
  })
);

/**
 * Field Names table - Maps field IDs to human-readable names
 * Extracted from supertag definitions during indexing
 */
export const fieldNames = sqliteTable(
  "field_names",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fieldId: text("field_id").notNull().unique(),
    fieldName: text("field_name").notNull(),
    supertags: text("supertags"), // JSON array of supertag names that use this field
  },
  (table) => ({
    fieldIdIdx: index("idx_field_names_fieldid").on(table.fieldId),
  })
);

/**
 * Field Values table - Stores extracted text-based field values
 * Links field values to their parent nodes and field definitions
 */
export const fieldValues = sqliteTable(
  "field_values",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tupleId: text("tuple_id").notNull(), // The tuple node containing this field
    parentId: text("parent_id").notNull(), // Parent node the field belongs to
    fieldDefId: text("field_def_id").notNull(), // Field definition ID (_sourceId)
    fieldName: text("field_name").notNull(), // Human-readable field name
    valueNodeId: text("value_node_id").notNull(), // Node containing value text
    valueText: text("value_text").notNull(), // Actual text content
    valueOrder: integer("value_order").default(0), // Order for multi-value fields
    created: integer("created"), // Timestamp from parent node
  },
  (table) => ({
    parentIdx: index("idx_field_values_parent").on(table.parentId),
    fieldNameIdx: index("idx_field_values_field_name").on(table.fieldName),
    fieldDefIdx: index("idx_field_values_field_def").on(table.fieldDefId),
    createdIdx: index("idx_field_values_created").on(table.created),
  })
);

/**
 * Field Exclusions table - Fields to skip during indexing
 * Used to filter out system fields that shouldn't be indexed
 */
export const fieldExclusions = sqliteTable("field_exclusions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fieldName: text("field_name").notNull().unique(),
  reason: text("reason"),
});

/**
 * Supertag Fields table - Field definitions for each supertag
 * Extracted from tagDef tuple children during indexing
 */
export const supertagFields = sqliteTable(
  "supertag_fields",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tagId: text("tag_id").notNull(), // tagDef node ID
    tagName: text("tag_name").notNull(), // Human-readable tag name
    fieldName: text("field_name").notNull(), // Field label (from tuple's first child)
    fieldLabelId: text("field_label_id").notNull(), // Node ID of the field label
    fieldOrder: integer("field_order").default(0), // Position in tagDef children
  },
  (table) => ({
    tagIdx: index("idx_supertag_fields_tag").on(table.tagId),
    nameIdx: index("idx_supertag_fields_name").on(table.tagName),
    // Unique constraint: tag_id + field_name
    uniqueTagField: index("idx_supertag_fields_unique").on(
      table.tagId,
      table.fieldName
    ),
  })
);

/**
 * Supertag Parents table - Direct inheritance relationships
 * Extracted from metaNode SYS_A13 tuples during indexing
 */
export const supertagParents = sqliteTable(
  "supertag_parents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    childTagId: text("child_tag_id").notNull(), // Child tagDef node ID
    parentTagId: text("parent_tag_id").notNull(), // Parent tagDef node ID
  },
  (table) => ({
    childIdx: index("idx_supertag_parents_child").on(table.childTagId),
    parentIdx: index("idx_supertag_parents_parent").on(table.parentTagId),
    // Unique constraint: child_tag_id + parent_tag_id
    uniqueRelation: index("idx_supertag_parents_unique").on(
      table.childTagId,
      table.parentTagId
    ),
  })
);

// Export type inference for use in queries
export type Node = typeof nodes.$inferSelect;
export type Supertag = typeof supertags.$inferSelect;
export type Field = typeof fields.$inferSelect;
export type Reference = typeof references.$inferSelect;
export type FieldName = typeof fieldNames.$inferSelect;
export type FieldValue = typeof fieldValues.$inferSelect;
export type FieldExclusion = typeof fieldExclusions.$inferSelect;
export type SupertagFieldRow = typeof supertagFields.$inferSelect;
export type SupertagParentRow = typeof supertagParents.$inferSelect;
