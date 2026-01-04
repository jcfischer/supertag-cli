/**
 * Tana Schema Registry
 *
 * Dynamically extracts and manages supertag schemas from Tana workspace exports.
 * Enables generic node creation for any supertag without hardcoded definitions.
 */

import type { TanaApiNode, TanaApiFieldNode } from '../types';
import { SYSTEM_FIELD_MARKERS } from '../db/supertag-metadata';

/**
 * Field schema definition
 */
export interface FieldSchema {
  /** Field attribute ID (used in API) */
  attributeId: string;
  /** Human-readable field name */
  name: string;
  /** Normalized name (lowercase, no special chars) */
  normalizedName: string;
  /** Optional description */
  description?: string;
  /** Data type hint (derived from usage) */
  dataType?: 'text' | 'date' | 'reference' | 'url' | 'number' | 'checkbox';
  /** Target supertag for reference fields (Options from Supertag) */
  targetSupertag?: {
    /** Target supertag ID */
    id: string;
    /** Target supertag name */
    name: string;
  } | null;
}

/**
 * Supertag schema definition
 */
export interface SupertagSchema {
  /** Supertag ID (used in API) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Normalized name (lowercase, no special chars) */
  normalizedName: string;
  /** Optional description */
  description?: string;
  /** Tag color (hex code or name) */
  color?: string;
  /** Fields belonging to this supertag */
  fields: FieldSchema[];
  /** Parent supertag IDs (for inheritance) */
  extends?: string[];
}

/**
 * Tana export document structure
 */
interface TanaDoc {
  id: string;
  props?: {
    name?: string;
    _docType?: string;
    _ownerId?: string;
    description?: string;
    _extends?: string;
    _metaNodeId?: string;
  };
  children?: string[] | null;
}

/**
 * Tana export structure (supports both direct and storeData wrapper formats)
 */
interface TanaExport {
  formatVersion?: number;
  docs?: TanaDoc[];
  storeData?: {
    formatVersion: number;
    docs: TanaDoc[];
  };
}

/**
 * Normalize a field/supertag name for matching
 * Handles kebab-case, camelCase, spaces, emojis
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove emojis and special chars
    .replace(/[\s-_]+/g, '')  // Remove spaces, dashes, underscores
    .trim();
}

/**
 * Compare two schemas to determine which should be canonical for name lookup
 * Prefers schemas with more inheritance parents, then more fields
 */
function shouldPreferSchema(newSchema: SupertagSchema, existingSchema: SupertagSchema): boolean {
  const newExtends = newSchema.extends?.length ?? 0;
  const existingExtends = existingSchema.extends?.length ?? 0;

  // Prefer schemas with more inheritance parents
  if (newExtends > existingExtends) return true;
  if (newExtends < existingExtends) return false;

  // Same number of parents - prefer more own fields
  return newSchema.fields.length > existingSchema.fields.length;
}

/**
 * Schema Registry for Tana supertags
 */
export class SchemaRegistry {
  private supertags: Map<string, SupertagSchema> = new Map();
  private supertagsByName: Map<string, SupertagSchema> = new Map(); // Case-sensitive exact name lookup
  private supertagsByNormalizedName: Map<string, SupertagSchema> = new Map(); // Kept for field matching
  private docsById: Map<string, TanaDoc> = new Map();
  private schemaPath?: string;

  /**
   * Create a SchemaRegistry
   * @param schemaPath Optional path to schema.json file for file-based loading
   */
  constructor(schemaPath?: string) {
    this.schemaPath = schemaPath;
  }

  /**
   * Load schema from file (uses schemaPath from constructor)
   * Reads the JSON file and loads export data
   */
  async load(): Promise<void> {
    if (!this.schemaPath) {
      throw new Error('No schema path provided. Use loadFromExport() directly or pass path to constructor.');
    }

    const file = Bun.file(this.schemaPath);
    if (!await file.exists()) {
      throw new Error(`Schema file not found: ${this.schemaPath}`);
    }

    const data = await file.json();
    this.loadFromExport(data);
  }

  /**
   * Find supertag by name (alias for getSupertag)
   */
  findTagByName(name: string): SupertagSchema | undefined {
    return this.getSupertag(name);
  }

  /**
   * Load schema from Tana workspace export JSON
   * Supports both direct format and storeData wrapper format
   */
  loadFromExport(exportData: TanaExport): void {
    // Handle both direct format and storeData wrapper
    const data = exportData.storeData ?? exportData;
    const docs = data.docs;

    if (!docs) {
      throw new Error('Invalid export format: no docs array found');
    }

    // Build document lookup
    this.docsById.clear();
    for (const doc of docs) {
      this.docsById.set(doc.id, doc);
    }

    // Find all supertags (tagDef documents, excluding system ones)
    const tagDefs = docs.filter(
      doc => doc.props?._docType === 'tagDef' &&
             !doc.id.startsWith('SYS_') &&
             doc.props?.name &&
             !doc.props.name.includes('<span') // Skip merged tags
    );

    // Process each supertag
    for (const tagDoc of tagDefs) {
      const schema = this.buildSupertagSchema(tagDoc);
      if (schema) {
        this.supertags.set(schema.id, schema);

        // Case-sensitive exact name lookup
        const existingByName = this.supertagsByName.get(schema.name);
        if (!existingByName || shouldPreferSchema(schema, existingByName)) {
          this.supertagsByName.set(schema.name, schema);
        }

        // Normalized name lookup (for field matching, kept for backwards compat)
        const existing = this.supertagsByNormalizedName.get(schema.normalizedName);
        if (!existing || shouldPreferSchema(schema, existing)) {
          this.supertagsByNormalizedName.set(schema.normalizedName, schema);
        }
      }
    }
  }

  /**
   * Build schema for a single supertag
   */
  private buildSupertagSchema(tagDoc: TanaDoc): SupertagSchema | null {
    if (!tagDoc.props?.name) return null;

    const fields: FieldSchema[] = [];

    // Process children (tuples linking to fields)
    if (tagDoc.children) {
      for (const childId of tagDoc.children) {
        const childDoc = this.docsById.get(childId);
        if (childDoc?.props?._docType === 'tuple' && childDoc.children?.length) {
          // First child of tuple is the field definition ID (attributeId)
          const fieldId = childDoc.children[0];
          const fieldDoc = this.docsById.get(fieldId);

          if (fieldDoc?.props?.name) {
            // Regular field with a node definition
            fields.push({
              attributeId: fieldId,
              name: fieldDoc.props.name,
              normalizedName: normalizeName(fieldDoc.props.name),
              description: fieldDoc.props.description,
              dataType: this.inferDataType(fieldDoc),
            });
          } else if (fieldId in SYSTEM_FIELD_MARKERS) {
            // System field marker (SYS_A61, SYS_A90, etc.)
            const systemFieldName = SYSTEM_FIELD_MARKERS[fieldId];
            fields.push({
              attributeId: fieldId,
              name: systemFieldName,
              normalizedName: normalizeName(systemFieldName),
              dataType: this.inferDataTypeFromName(systemFieldName),
            });
          }
        }
      }
    }

    // Extract parent supertags from _metaNodeId
    const parentTagIds = this.extractParentTagIds(tagDoc);

    return {
      id: tagDoc.id,
      name: tagDoc.props.name,
      normalizedName: normalizeName(tagDoc.props.name),
      description: tagDoc.props.description,
      fields,
      extends: parentTagIds.length > 0 ? parentTagIds : undefined,
    };
  }

  /**
   * Extract parent supertag IDs from the tag's _metaNodeId
   * Inheritance is stored in tuples where SYS_A13 is the first child
   */
  private extractParentTagIds(tagDoc: TanaDoc): string[] {
    const metaNodeId = tagDoc.props?._metaNodeId;
    if (!metaNodeId) return [];

    const metaNode = this.docsById.get(metaNodeId);
    if (!metaNode?.children) return [];

    const parentTagIds: string[] = [];

    // Look through meta node's children for tuples with SYS_A13 (supertags attribute)
    for (const childId of metaNode.children) {
      const childDoc = this.docsById.get(childId);
      if (childDoc?.props?._docType === 'tuple' && childDoc.children?.length) {
        // First child is the attribute ID
        const attrId = childDoc.children[0];

        // SYS_A13 is the "Node supertag(s)" attribute - this indicates inheritance
        if (attrId === 'SYS_A13') {
          // Remaining children are the parent tag IDs
          for (let i = 1; i < childDoc.children.length; i++) {
            const parentId = childDoc.children[i];
            // Skip system tags (SYS_T01, SYS_T100, etc.) - they're internal
            if (!parentId.startsWith('SYS_')) {
              // Verify it's actually a tagDef
              const parentDoc = this.docsById.get(parentId);
              if (parentDoc?.props?._docType === 'tagDef') {
                parentTagIds.push(parentId);
              }
            }
          }
        }
      }
    }

    return parentTagIds;
  }

  /**
   * Infer data type from field document
   */
  private inferDataType(fieldDoc: TanaDoc): FieldSchema['dataType'] {
    return this.inferDataTypeFromName(fieldDoc.props?.name || '');
  }

  /**
   * Infer data type from field name
   */
  private inferDataTypeFromName(fieldName: string): FieldSchema['dataType'] {
    const name = fieldName.toLowerCase();

    if (name.includes('date') || name.includes('time')) return 'date';
    if (name.includes('url') || name.includes('link')) return 'url';
    if (name.includes('count') || name.includes('number') || name.includes('amount')) return 'number';
    if (name.includes('status') || name.includes('type') || name.includes('category')) return 'reference';

    return 'text';
  }

  /**
   * Get supertag by name (case-sensitive)
   */
  getSupertag(name: string): SupertagSchema | undefined {
    return this.supertagsByName.get(name);
  }

  /**
   * Get supertag by ID
   */
  getSupertagById(id: string): SupertagSchema | undefined {
    return this.supertags.get(id);
  }

  /**
   * List all supertags
   */
  listSupertags(): SupertagSchema[] {
    return Array.from(this.supertags.values());
  }

  /**
   * Get fields for a supertag (includes all inherited fields recursively)
   */
  getFields(supertagName: string): FieldSchema[] {
    const schema = this.getSupertag(supertagName);
    if (!schema) return [];

    return this.collectFieldsRecursive(schema, new Set());
  }

  /**
   * Get fields for multiple supertags (combined and deduplicated)
   */
  getFieldsForMultipleSupertags(supertagNames: string[]): FieldSchema[] {
    const allFields: FieldSchema[] = [];
    const seenAttributeIds = new Set<string>();

    for (const name of supertagNames) {
      const fields = this.getFields(name);
      for (const field of fields) {
        if (!seenAttributeIds.has(field.attributeId)) {
          seenAttributeIds.add(field.attributeId);
          allFields.push(field);
        }
      }
    }

    return allFields;
  }

  /**
   * Recursively collect fields from schema and all parent schemas
   * Uses visited set to prevent infinite loops from circular inheritance
   */
  private collectFieldsRecursive(schema: SupertagSchema, visited: Set<string>): FieldSchema[] {
    // Prevent infinite loops from circular inheritance
    if (visited.has(schema.id)) return [];
    visited.add(schema.id);

    const fields = [...schema.fields];

    // Recursively add inherited fields from all parents
    if (schema.extends) {
      for (const parentId of schema.extends) {
        const parent = this.getSupertagById(parentId);
        if (parent) {
          fields.push(...this.collectFieldsRecursive(parent, visited));
        }
      }
    }

    return fields;
  }

  /**
   * Search supertags by partial name match
   */
  searchSupertags(query: string): SupertagSchema[] {
    const normalized = normalizeName(query);
    return this.listSupertags().filter(s =>
      s.normalizedName.includes(normalized) ||
      s.name.toLowerCase().includes(query.toLowerCase())
    );
  }

  /**
   * Parse supertag input into array of names
   * Handles: string, comma-separated string, or array
   */
  private parseSupertagInput(input: string | string[]): string[] {
    if (Array.isArray(input)) {
      return input;
    }
    // Handle comma-separated string
    if (input.includes(',')) {
      return input.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
    return [input];
  }

  /**
   * Build a Tana API node payload for one or more supertags
   * @param supertagInput Single supertag name, comma-separated names, or array of names
   * @param nodeName Node name
   * @param fieldValues Field values
   */
  buildNodePayload(
    supertagInput: string | string[],
    nodeName: string,
    fieldValues: Record<string, string | string[] | boolean>,
  ): TanaApiNode {
    const supertagNames = this.parseSupertagInput(supertagInput);

    // Deduplicate supertag names (case-sensitive)
    const uniqueNames = [...new Set(supertagNames)];

    // Resolve all schemas and validate
    const schemas: SupertagSchema[] = [];
    for (const name of uniqueNames) {
      const schema = this.getSupertag(name);
      if (!schema) {
        throw new Error(`Unknown supertag: ${name}`);
      }
      schemas.push(schema);
    }

    // Get combined fields from all supertags
    const allFields = this.getFieldsForMultipleSupertags(uniqueNames);

    const children: (TanaApiNode | TanaApiFieldNode)[] = [];

    // Process each provided field value
    for (const [fieldName, value] of Object.entries(fieldValues)) {
      const normalizedFieldName = normalizeName(fieldName);
      const fieldSchema = allFields.find(f => f.normalizedName === normalizedFieldName);

      if (!fieldSchema) {
        // Skip unknown fields (graceful degradation)
        continue;
      }

      const fieldNode = this.buildFieldNode(fieldSchema, value);
      if (fieldNode) {
        children.push(fieldNode);
      }
    }

    // Deduplicate supertag IDs (in case same tag resolved via different names)
    const uniqueTagIds = [...new Set(schemas.map(s => s.id))];

    return {
      name: nodeName,
      supertags: uniqueTagIds.map(id => ({ id })),
      children: children.length > 0 ? children : undefined,
    };
  }

  /**
   * Build a field node from schema and value
   */
  private buildFieldNode(
    fieldSchema: FieldSchema,
    value: string | string[] | boolean,
  ): TanaApiFieldNode | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const fieldChildren: TanaApiNode[] = [];

    // Handle different data types
    switch (fieldSchema.dataType) {
      case 'date':
        fieldChildren.push({
          dataType: 'date',
          name: String(value),
        });
        break;

      case 'reference':
        // Check if it's an ID or a name
        if (typeof value === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(value)) {
          fieldChildren.push({
            dataType: 'reference',
            id: value,
          } as TanaApiNode);
        } else {
          fieldChildren.push({
            name: String(value),
          });
        }
        break;

      case 'url':
        fieldChildren.push({
          dataType: 'url',
          name: String(value),
        });
        break;

      case 'checkbox':
        fieldChildren.push({
          name: value ? 'true' : 'false',
        });
        break;

      case 'number':
        fieldChildren.push({
          name: String(value),
        });
        break;

      default:
        // Handle arrays (multiple values)
        if (Array.isArray(value)) {
          for (const v of value) {
            fieldChildren.push({ name: String(v) });
          }
        } else {
          fieldChildren.push({ name: String(value) });
        }
    }

    return {
      type: 'field',
      attributeId: fieldSchema.attributeId,
      children: fieldChildren,
    };
  }

  /**
   * Serialize registry to JSON
   */
  toJSON(): string {
    const data = {
      version: 1,
      supertags: Array.from(this.supertags.values()),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Deserialize registry from JSON
   */
  static fromJSON(json: string): SchemaRegistry {
    const data = JSON.parse(json);
    const registry = new SchemaRegistry();

    for (const schema of data.supertags) {
      registry.supertags.set(schema.id, schema);

      // Case-sensitive exact name lookup
      const existingByName = registry.supertagsByName.get(schema.name);
      if (!existingByName || shouldPreferSchema(schema, existingByName)) {
        registry.supertagsByName.set(schema.name, schema);
      }

      // For normalized lookup, prefer schemas with inheritance/more fields
      const existing = registry.supertagsByNormalizedName.get(schema.normalizedName);
      if (!existing || shouldPreferSchema(schema, existing)) {
        registry.supertagsByNormalizedName.set(schema.normalizedName, schema);
      }
    }

    return registry;
  }
}
