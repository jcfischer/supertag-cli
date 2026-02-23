/**
 * Schema Audit Detectors (F-101)
 *
 * Seven detectors that analyze a WorkspaceSchema and produce SchemaFindings.
 * All detectors are read-only and stateless.
 */

import type {
  SchemaDetector,
  SchemaFinding,
  UsageLocation,
  WorkspaceSchema,
  InheritanceRelation,
} from '../types/schema-audit';

/** System docTypes to exclude from audit findings */
const SYSTEM_TYPES = new Set([
  'tuple', 'metanode', 'viewDef', 'field', 'search',
  'codeblock', 'image', 'url', 'video', 'audio',
]);

function isSystemTag(name: string): boolean {
  return SYSTEM_TYPES.has(name);
}

/**
 * Build a set of tag IDs that are related via inheritance
 * (parent, child, or sharing a common ancestor).
 */
function buildInheritanceMap(
  inheritance: InheritanceRelation[]
): Map<string, Set<string>> {
  const related = new Map<string, Set<string>>();

  for (const rel of inheritance) {
    if (!related.has(rel.childTagId)) {
      related.set(rel.childTagId, new Set());
    }
    if (!related.has(rel.parentTagId)) {
      related.set(rel.parentTagId, new Set());
    }
    related.get(rel.childTagId)!.add(rel.parentTagId);
    related.get(rel.parentTagId)!.add(rel.childTagId);
  }

  return related;
}

function areRelated(
  tagA: string,
  tagB: string,
  inheritanceMap: Map<string, Set<string>>
): boolean {
  const relA = inheritanceMap.get(tagA);
  if (relA && relA.has(tagB)) return true;
  const relB = inheritanceMap.get(tagB);
  if (relB && relB.has(tagA)) return true;

  // Check for siblings: two tags sharing a common ancestor
  if (relA && relB) {
    for (const ancestor of relA) {
      if (relB.has(ancestor)) return true;
    }
  }
  return false;
}

// ── Orphan Tags Detector ──────────────────────────────────────────────

export const orphanTagsDetector: SchemaDetector = {
  name: 'orphan-tags',
  description: 'Detect supertags with zero instances',
  detect(schema: WorkspaceSchema): SchemaFinding[] {
    return schema.supertags
      .filter(s => !isSystemTag(s.name) && s.instanceCount === 0)
      .map(s => ({
        detector: 'orphan-tags',
        severity: 'warning' as const,
        message: `Supertag "${s.name}" has zero instances`,
        details: {
          tagId: s.id,
          tagName: s.name,
          instanceCount: 0,
          suggestion: `Consider removing "${s.name}" if no longer needed`,
          usageLocations: [{ tagId: s.id, tagName: s.name }],
        },
      }));
  },
};

// ── Low Usage Tags Detector ───────────────────────────────────────────

export const lowUsageTagsDetector: SchemaDetector = {
  name: 'low-usage-tags',
  description: 'Detect supertags with fewer than 3 instances',
  detect(schema: WorkspaceSchema): SchemaFinding[] {
    return schema.supertags
      .filter(s => !isSystemTag(s.name) && s.instanceCount > 0 && s.instanceCount < 3)
      .map(s => ({
        detector: 'low-usage-tags',
        severity: 'info' as const,
        message: `Supertag "${s.name}" has only ${s.instanceCount} instance(s)`,
        details: {
          tagId: s.id,
          tagName: s.name,
          instanceCount: s.instanceCount,
          suggestion: `Consider merging "${s.name}" into a more general supertag`,
          usageLocations: [{ tagId: s.id, tagName: s.name }],
        },
      }));
  },
};

// ── Duplicate Fields Detector ─────────────────────────────────────────

export const duplicateFieldsDetector: SchemaDetector = {
  name: 'duplicate-fields',
  description: 'Detect same field name on unrelated tags',
  detect(schema: WorkspaceSchema): SchemaFinding[] {
    const findings: SchemaFinding[] = [];
    const inheritanceMap = buildInheritanceMap(schema.inheritance);

    // Group fields by name
    const fieldsByName = new Map<string, typeof schema.fields>();
    for (const field of schema.fields) {
      const existing = fieldsByName.get(field.fieldName) || [];
      existing.push(field);
      fieldsByName.set(field.fieldName, existing);
    }

    // Check for duplicates across unrelated tags
    for (const [fieldName, fields] of fieldsByName) {
      if (fields.length < 2) continue;

      // Get unique tag IDs
      const tagIds = [...new Set(fields.map(f => f.tagId))];
      if (tagIds.length < 2) continue;

      // Find unrelated pairs
      const unrelatedTags: string[] = [];
      for (let i = 0; i < tagIds.length; i++) {
        for (let j = i + 1; j < tagIds.length; j++) {
          if (!areRelated(tagIds[i], tagIds[j], inheritanceMap)) {
            if (!unrelatedTags.includes(tagIds[i])) unrelatedTags.push(tagIds[i]);
            if (!unrelatedTags.includes(tagIds[j])) unrelatedTags.push(tagIds[j]);
          }
        }
      }

      if (unrelatedTags.length >= 2) {
        const tagNames = unrelatedTags
          .map(id => fields.find(f => f.tagId === id)?.tagName || id)
          .join(', ');

        const usageLocations: UsageLocation[] = unrelatedTags.map(tagId => {
          const field = fields.find(f => f.tagId === tagId);
          return {
            tagId,
            tagName: field?.tagName || tagId,
            fieldId: field?.fieldLabelId,
            fieldName,
            dataType: field?.inferredDataType || undefined,
          };
        });

        findings.push({
          detector: 'duplicate-fields',
          severity: 'warning',
          message: `Field "${fieldName}" defined on unrelated tags: ${tagNames}`,
          details: {
            fieldName,
            relatedIds: unrelatedTags,
            suggestion: `Consider creating a shared parent supertag with "${fieldName}" field`,
            usageLocations,
          },
        });
      }
    }

    return findings;
  },
};

// ── Type Mismatch Detector ────────────────────────────────────────────

export const typeMismatchDetector: SchemaDetector = {
  name: 'type-mismatch',
  description: 'Detect same field name with different types across tags',
  detect(schema: WorkspaceSchema): SchemaFinding[] {
    const findings: SchemaFinding[] = [];

    // Group fields by name
    const fieldsByName = new Map<string, typeof schema.fields>();
    for (const field of schema.fields) {
      if (!field.inferredDataType) continue;
      const existing = fieldsByName.get(field.fieldName) || [];
      existing.push(field);
      fieldsByName.set(field.fieldName, existing);
    }

    for (const [fieldName, fields] of fieldsByName) {
      const types = [...new Set(fields.map(f => f.inferredDataType).filter(Boolean))];
      if (types.length < 2) continue;

      const examples = fields
        .slice(0, 3)
        .map(f => `${f.tagName}:${f.inferredDataType}`)
        .join(', ');

      const usageLocations: UsageLocation[] = fields.map(f => ({
        tagId: f.tagId,
        tagName: f.tagName,
        fieldId: f.fieldLabelId,
        fieldName: f.fieldName,
        dataType: f.inferredDataType || undefined,
      }));

      findings.push({
        detector: 'type-mismatch',
        severity: 'error',
        message: `Field "${fieldName}" has conflicting types: ${types.join(', ')}`,
        details: {
          fieldName,
          relatedIds: fields.map(f => f.tagId),
          suggestion: `Standardize "${fieldName}" to a single type (used as: ${examples})`,
          usageLocations,
        },
      });
    }

    return findings;
  },
};

// ── Unused Fields Detector ────────────────────────────────────────────

export const unusedFieldsDetector: SchemaDetector = {
  name: 'unused-fields',
  description: 'Detect fields with zero fill rate',
  detect(schema: WorkspaceSchema): SchemaFinding[] {
    const findings: SchemaFinding[] = [];

    // Build fill rate lookup: field_name + tag_id -> fill rate
    const fillRateMap = new Map<string, number>();
    for (const fv of schema.fieldValues) {
      fillRateMap.set(`${fv.fieldName}:${fv.tagId}`, fv.fillRate);
    }

    // Find fields with no fill rate entry (meaning zero populated)
    for (const field of schema.fields) {
      const key = `${field.fieldName}:${field.tagId}`;
      const fillRate = fillRateMap.get(key);

      // Only flag if the tag has instances but field is never populated
      const tagApp = schema.tagApplications.find(ta => ta.tagId === field.tagId);
      if (!tagApp || tagApp.instanceCount === 0) continue;

      if (fillRate === undefined || fillRate === 0) {
        findings.push({
          detector: 'unused-fields',
          severity: 'info',
          message: `Field "${field.fieldName}" on "${field.tagName}" is never populated`,
          details: {
            fieldId: field.fieldLabelId,
            fieldName: field.fieldName,
            tagId: field.tagId,
            tagName: field.tagName,
            fillRate: 0,
            suggestion: `Consider removing "${field.fieldName}" from "${field.tagName}" if not needed`,
            usageLocations: [{
              tagId: field.tagId,
              tagName: field.tagName,
              fieldId: field.fieldLabelId,
              fieldName: field.fieldName,
            }],
          },
        });
      }
    }

    return findings;
  },
};

// ── Fill Rate Detector ────────────────────────────────────────────────

export const fillRateDetector: SchemaDetector = {
  name: 'fill-rate',
  description: 'Detect fields with less than 10% fill rate',
  detect(schema: WorkspaceSchema): SchemaFinding[] {
    return schema.fieldValues
      .filter(fv => fv.fillRate > 0 && fv.fillRate < 10)
      .map(fv => {
        const field = schema.fields.find(
          f => f.fieldName === fv.fieldName && f.tagId === fv.tagId
        );
        return {
          detector: 'fill-rate',
          severity: 'info' as const,
          message: `Field "${fv.fieldName}" on "${field?.tagName || fv.tagId}" has ${fv.fillRate.toFixed(1)}% fill rate`,
          details: {
            fieldName: fv.fieldName,
            tagId: fv.tagId,
            tagName: field?.tagName,
            fieldId: field?.fieldLabelId,
            fillRate: fv.fillRate,
            suggestion: `Review if "${fv.fieldName}" is still useful (${fv.populatedCount}/${fv.totalInstances} populated)`,
            usageLocations: [{
              tagId: fv.tagId,
              tagName: field?.tagName || fv.tagId,
              fieldId: field?.fieldLabelId,
              fieldName: fv.fieldName,
            }],
          },
        };
      });
  },
};

// ── Missing Inheritance Detector ──────────────────────────────────────

export const missingInheritanceDetector: SchemaDetector = {
  name: 'missing-inheritance',
  description: 'Detect tags sharing 3+ identical fields without common parent',
  detect(schema: WorkspaceSchema): SchemaFinding[] {
    // Skip if too few tags to be meaningful
    if (schema.supertags.length < 5) return [];

    const findings: SchemaFinding[] = [];
    const inheritanceMap = buildInheritanceMap(schema.inheritance);

    // Group fields by tag
    const fieldsByTag = new Map<string, Set<string>>();
    for (const field of schema.fields) {
      if (!fieldsByTag.has(field.tagId)) {
        fieldsByTag.set(field.tagId, new Set());
      }
      fieldsByTag.get(field.tagId)!.add(field.fieldName);
    }

    const tagIds = [...fieldsByTag.keys()];
    const checked = new Set<string>();

    for (let i = 0; i < tagIds.length; i++) {
      for (let j = i + 1; j < tagIds.length; j++) {
        const tagA = tagIds[i];
        const tagB = tagIds[j];
        const pairKey = [tagA, tagB].sort().join(':');

        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        // Skip if already related via inheritance
        if (areRelated(tagA, tagB, inheritanceMap)) continue;

        const fieldsA = fieldsByTag.get(tagA)!;
        const fieldsB = fieldsByTag.get(tagB)!;

        // Find shared field names
        const shared = [...fieldsA].filter(f => fieldsB.has(f));

        if (shared.length >= 3) {
          const tagNameA = schema.supertags.find(s => s.id === tagA)?.name || tagA;
          const tagNameB = schema.supertags.find(s => s.id === tagB)?.name || tagB;

          findings.push({
            detector: 'missing-inheritance',
            severity: 'info',
            message: `"${tagNameA}" and "${tagNameB}" share ${shared.length} fields: ${shared.join(', ')}`,
            details: {
              relatedIds: [tagA, tagB],
              suggestion: `Consider creating a parent supertag with shared fields: ${shared.join(', ')}`,
              usageLocations: [
                { tagId: tagA, tagName: tagNameA },
                { tagId: tagB, tagName: tagNameB },
              ],
            },
          });
        }
      }
    }

    return findings;
  },
};
