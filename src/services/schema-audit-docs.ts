/**
 * Schema Documentation Generator (F-101)
 *
 * Generates markdown schema reference from workspace schema.
 */

import type { WorkspaceSchema, FieldInfo } from '../types/schema-audit';

/**
 * Generate markdown documentation for the workspace schema.
 */
export function generateSchemaDocumentation(schema: WorkspaceSchema): string {
  const lines: string[] = [];
  lines.push('# Workspace Schema Reference');
  lines.push('');

  // Build fill rate lookup
  const fillRateMap = new Map<string, number>();
  for (const fv of schema.fieldValues) {
    fillRateMap.set(`${fv.fieldName}:${fv.tagId}`, fv.fillRate);
  }

  // Build inheritance lookup
  const parentMap = new Map<string, string[]>();
  for (const rel of schema.inheritance) {
    const parents = parentMap.get(rel.childTagId) || [];
    parents.push(rel.parentTagId);
    parentMap.set(rel.childTagId, parents);
  }

  // Build "used by" lookup (which fields reference this tag)
  const usedByMap = new Map<string, string[]>();
  for (const field of schema.fields) {
    if (field.targetSupertagId) {
      const usedBy = usedByMap.get(field.targetSupertagId) || [];
      usedBy.push(`${field.tagName}.${field.fieldName}`);
      usedByMap.set(field.targetSupertagId, usedBy);
    }
  }

  // Sort supertags by instance count descending, then name
  const sorted = [...schema.supertags].sort((a, b) => {
    if (b.instanceCount !== a.instanceCount) return b.instanceCount - a.instanceCount;
    return a.name.localeCompare(b.name);
  });

  for (const tag of sorted) {
    lines.push(`## ${tag.name} (#${tag.normalizedName}) — ${tag.instanceCount} instances`);

    // Extends
    const parents = parentMap.get(tag.id);
    if (parents && parents.length > 0) {
      const parentNames = parents
        .map(pid => schema.supertags.find(s => s.id === pid)?.name || pid)
        .join(', ');
      lines.push(`Extends: ${parentNames}`);
    } else {
      lines.push('Extends: —');
    }

    // Fields
    const fields = schema.fields.filter(f => f.tagId === tag.id);
    if (fields.length > 0) {
      lines.push('Fields:');
      for (const field of fields) {
        const fillRate = fillRateMap.get(`${field.fieldName}:${tag.id}`);
        const typeInfo = formatFieldType(field);
        const fillInfo = fillRate !== undefined ? ` — ${fillRate.toFixed(0)}% filled` : '';
        lines.push(`  - ${field.fieldName}${typeInfo}${fillInfo}`);
      }
    } else {
      lines.push('Fields: none');
    }

    // Used by
    const usedBy = usedByMap.get(tag.id);
    if (usedBy && usedBy.length > 0) {
      lines.push(`Used by: ${usedBy.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function formatFieldType(field: FieldInfo): string {
  if (!field.inferredDataType) return '';
  if (field.targetSupertagId) {
    return ` (instance → #${field.targetSupertagId})`;
  }
  return ` (${field.inferredDataType})`;
}
