/**
 * tana_node Tool
 *
 * Show full contents of a specific node by ID, including fields, tags, and children.
 * Supports depth traversal for nested content.
 */

import type { Database } from 'bun:sqlite';
import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import type { NodeInput } from '../schemas.js';
import { withDbRetrySync } from '../../db/retry.js';
import { withDatabase } from '../../db/with-database.js';
import {
  parseSelectPaths,
  applyProjection,
} from '../../utils/select-projection.js';
import { formatInlineRefs } from '../../utils/inline-ref-formatter.js';

interface NodeData {
  id: string;
  name: string | null;
  created: number | null;
  rawData: string;
}

interface FieldValue {
  fieldName: string;
  fieldId: string;
  value: string;
  valueId: string;
}

export interface NodeContents {
  id: string;
  name: string;
  created: Date | null;
  tags: string[];
  fields: FieldValue[];
  children: NodeContents[];
}

/**
 * Get field name from database or fallback to hardcoded mappings
 */
function getFieldNameFromDb(db: Database, fieldId: string): string {
  const result = withDbRetrySync(
    () => db
      .query('SELECT field_name FROM field_names WHERE field_id = ?')
      .get(fieldId) as { field_name: string } | null,
    "node getFieldNameFromDb"
  );

  if (result?.field_name) {
    return result.field_name;
  }

  const fallbackFields: Record<string, string> = {
    SYS_A13: 'Tag',
    SYS_A61: 'Due date',
    SYS_A90: 'Date',
    SYS_A142: 'Attendees',
    SYS_T01: 'Supertag',
    SYS_T02: 'Field',
    Mp2A7_2PQw: 'Attendees',
  };

  return fallbackFields[fieldId] || fieldId;
}

function isFieldName(name: string | null | undefined): boolean {
  if (!name) return false;
  return (
    name.startsWith('⚙️') ||
    ['Outcome', 'Origin', 'Focus', 'Status', 'Vault', 'Due date', 'Do date'].includes(name)
  );
}

function formatValue(name: string | null | undefined, id: string): string {
  if (!name) return id;
  return formatInlineRefs(name, { fallback: id });
}

/**
 * Get basic node contents without recursive children
 */
function getNodeContentsBasic(db: Database, nodeId: string): NodeContents | null {
  const nodeResult = withDbRetrySync(
    () => db
      .query('SELECT id, name, created, raw_data as rawData FROM nodes WHERE id = ?')
      .get(nodeId) as NodeData | null,
    "node getNodeContentsBasic"
  );

  if (!nodeResult) {
    return null;
  }

  const rawData = JSON.parse(nodeResult.rawData);
  const childIds: string[] = rawData.children || [];

  const placeholders = childIds.map(() => '?').join(',');
  const childrenData =
    childIds.length > 0
      ? withDbRetrySync(
          () => db
            .query(
              `SELECT id, name, raw_data as rawData FROM nodes WHERE id IN (${placeholders})`
            )
            .all(...childIds) as NodeData[],
          "node getNodeContentsBasic children"
        )
      : [];

  const childMap = new Map(childrenData.map((c) => [c.id, c]));

  const fields: FieldValue[] = [];
  const contentChildren: NodeContents[] = [];
  const tags: string[] = [];

  for (const childId of childIds) {
    const child = childMap.get(childId);
    if (!child) continue;

    const childRaw = JSON.parse(child.rawData);

    if (childRaw.props?._docType === 'tuple') {
      const tupleChildren: string[] = childRaw.children || [];

      if (tupleChildren.length >= 1) {
        const resolvedPlaceholders = tupleChildren.map(() => '?').join(',');
        const resolvedNodes =
          tupleChildren.length > 0
            ? withDbRetrySync(
                () => db
                  .query(
                    `SELECT id, name FROM nodes WHERE id IN (${resolvedPlaceholders})`
                  )
                  .all(...tupleChildren) as Array<{ id: string; name: string | null }>,
                "node resolvedNodes"
              )
            : [];

        const resolvedMap = new Map(resolvedNodes.map((n) => [n.id, n.name]));

        let fieldName = '';
        let fieldId = '';
        const values: string[] = [];
        let valueId = '';

        for (const id of tupleChildren) {
          const name = resolvedMap.get(id);
          const mappedName = getFieldNameFromDb(db, id);

          if (id.startsWith('SYS_')) {
            fieldName = mappedName;
            fieldId = id;
          } else if (mappedName !== id) {
            fieldName = mappedName;
            fieldId = id;
          } else if (name?.startsWith('⚙️') || isFieldName(name)) {
            fieldName = name || id;
            fieldId = id;
          } else {
            const formattedValue = formatValue(name, id);
            values.push(formattedValue);
            if (!valueId) valueId = id;
          }
        }

        const meaningfulValues = values.filter((v) => {
          if (v.match(/^\d{4}-\d{2}-\d{2}/)) return true;
          if (v.startsWith('[[')) return true;
          if (v.match(/^[a-zA-Z0-9_-]{12,}$/)) return false;
          return true;
        });

        if (fieldName && meaningfulValues.length > 0) {
          fields.push({
            fieldName,
            fieldId,
            value: meaningfulValues.join(', '),
            valueId,
          });
        }
      }
    } else {
      // Content child - add as placeholder (will be expanded if depth > 0)
      contentChildren.push({
        id: childId,
        name: child.name || '(unnamed)',
        created: null,
        tags: [],
        fields: [],
        children: [],
      });
    }
  }

  const tagResults = withDbRetrySync(
    () => db
      .query('SELECT tag_name FROM tag_applications WHERE data_node_id = ?')
      .all(nodeId) as Array<{ tag_name: string }>,
    "node tagResults"
  );

  tags.push(...tagResults.map((t) => t.tag_name));

  return {
    id: nodeId,
    name: nodeResult.name || '(unnamed)',
    created: nodeResult.created ? new Date(nodeResult.created) : null,
    tags,
    fields,
    children: contentChildren,
  };
}

/**
 * Recursively build node contents with depth traversal
 */
function getNodeContentsWithDepth(
  db: Database,
  nodeId: string,
  currentDepth: number,
  maxDepth: number
): NodeContents | null {
  const contents = getNodeContentsBasic(db, nodeId);
  if (!contents) return null;

  // Recurse into children if within depth limit
  if (currentDepth < maxDepth && contents.children.length > 0) {
    const expandedChildren: NodeContents[] = [];

    for (const child of contents.children) {
      const childContents = getNodeContentsWithDepth(
        db,
        child.id,
        currentDepth + 1,
        maxDepth
      );
      if (childContents) {
        expandedChildren.push(childContents);
      }
    }

    contents.children = expandedChildren;
  }

  return contents;
}

export async function showNode(input: NodeInput): Promise<Partial<Record<string, unknown>> | null> {
  const workspace = resolveWorkspaceContext({ workspace: input.workspace });
  const depth = input.depth || 0;

  const result = withDatabase({ dbPath: workspace.dbPath, readonly: true }, (ctx) => {
    if (depth > 0) {
      return getNodeContentsWithDepth(ctx.db, input.nodeId, 0, depth);
    } else {
      return getNodeContentsBasic(ctx.db, input.nodeId);
    }
  });

  if (!result) {
    return null;
  }

  // Apply field projection if select is specified
  const projection = parseSelectPaths(input.select);
  return applyProjection(result, projection);
}
