/**
 * Schema Audit Detectors Tests (F-101)
 */

import { describe, it, expect } from 'bun:test';
import type { WorkspaceSchema } from '../src/types/schema-audit';
import {
  orphanTagsDetector,
  lowUsageTagsDetector,
  duplicateFieldsDetector,
  typeMismatchDetector,
  unusedFieldsDetector,
  fillRateDetector,
  missingInheritanceDetector,
} from '../src/services/schema-audit-detectors';
import { runDetectors } from '../src/services/schema-audit-registry';

function createEmptySchema(): WorkspaceSchema {
  return {
    supertags: [],
    fields: [],
    inheritance: [],
    tagApplications: [],
    fieldValues: [],
  };
}

// ── Orphan Tags ────────────────────────────────────────────

describe('orphan-tags detector', () => {
  it('detects tags with zero instances', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Orphan', normalizedName: 'orphan', description: null, color: null, instanceCount: 0, lastUsed: null },
      { id: 't2', name: 'Active', normalizedName: 'active', description: null, color: null, instanceCount: 5, lastUsed: null },
    ];

    const findings = orphanTagsDetector.detect(schema);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].details.tagName).toBe('Orphan');
  });

  it('returns no findings when all tags have instances', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Active', normalizedName: 'active', description: null, color: null, instanceCount: 10, lastUsed: null },
    ];

    const findings = orphanTagsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });

  it('excludes system tags', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'tuple', normalizedName: 'tuple', description: null, color: null, instanceCount: 0, lastUsed: null },
      { id: 't2', name: 'viewDef', normalizedName: 'viewdef', description: null, color: null, instanceCount: 0, lastUsed: null },
    ];

    const findings = orphanTagsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });
});

// ── Low Usage Tags ─────────────────────────────────────────

describe('low-usage-tags detector', () => {
  it('detects tags with fewer than 3 instances', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Rare', normalizedName: 'rare', description: null, color: null, instanceCount: 1, lastUsed: null },
      { id: 't2', name: 'Common', normalizedName: 'common', description: null, color: null, instanceCount: 10, lastUsed: null },
    ];

    const findings = lowUsageTagsDetector.detect(schema);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].details.tagName).toBe('Rare');
  });

  it('does not flag zero-instance tags (orphan detector handles those)', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Empty', normalizedName: 'empty', description: null, color: null, instanceCount: 0, lastUsed: null },
    ];

    const findings = lowUsageTagsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });

  it('does not flag tags with exactly 3 instances', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Borderline', normalizedName: 'borderline', description: null, color: null, instanceCount: 3, lastUsed: null },
    ];

    const findings = lowUsageTagsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });
});

// ── Duplicate Fields ───────────────────────────────────────

describe('duplicate-fields detector', () => {
  it('detects same field name on unrelated tags', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Email', tagId: 't1', tagName: 'Person', inferredDataType: 'email', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Email', tagId: 't2', tagName: 'Company', inferredDataType: 'email', targetSupertagId: null, order: 0 },
    ];
    schema.supertags = [
      { id: 't1', name: 'Person', normalizedName: 'person', description: null, color: null, instanceCount: 5, lastUsed: null },
      { id: 't2', name: 'Company', normalizedName: 'company', description: null, color: null, instanceCount: 3, lastUsed: null },
    ];

    const findings = duplicateFieldsDetector.detect(schema);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].details.fieldName).toBe('Email');
  });

  it('does not flag fields on related (inherited) tags', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Name', tagId: 'parent', tagName: 'Entity', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Name', tagId: 'child', tagName: 'Person', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
    ];
    schema.inheritance = [{ childTagId: 'child', parentTagId: 'parent' }];

    const findings = duplicateFieldsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });

  it('returns no findings when field is unique', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Email', tagId: 't1', tagName: 'Person', inferredDataType: 'email', targetSupertagId: null, order: 0 },
    ];

    const findings = duplicateFieldsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });
});

// ── Type Mismatch ──────────────────────────────────────────

describe('type-mismatch detector', () => {
  it('flags same field name with different types', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Date', tagId: 't1', tagName: 'Meeting', inferredDataType: 'date', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Date', tagId: 't2', tagName: 'Event', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
    ];

    const findings = typeMismatchDetector.detect(schema);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].details.fieldName).toBe('Date');
  });

  it('does not flag when types match', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Email', tagId: 't1', tagName: 'Person', inferredDataType: 'email', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Email', tagId: 't2', tagName: 'Company', inferredDataType: 'email', targetSupertagId: null, order: 0 },
    ];

    const findings = typeMismatchDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });

  it('ignores fields without inferred type', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Notes', tagId: 't1', tagName: 'Person', inferredDataType: null, targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Notes', tagId: 't2', tagName: 'Meeting', inferredDataType: null, targetSupertagId: null, order: 0 },
    ];

    const findings = typeMismatchDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });
});

// ── Unused Fields ──────────────────────────────────────────

describe('unused-fields detector', () => {
  it('finds fields with zero fill rate', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Phone', tagId: 't1', tagName: 'Person', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
    ];
    schema.tagApplications = [{ tagId: 't1', instanceCount: 10 }];
    // No field_values entry for Phone → 0% fill rate

    const findings = unusedFieldsDetector.detect(schema);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].details.fieldName).toBe('Phone');
    expect(findings[0].details.fillRate).toBe(0);
  });

  it('does not flag fields on tags with zero instances', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Phone', tagId: 't1', tagName: 'Orphan', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
    ];
    // No tag applications → tag has 0 instances

    const findings = unusedFieldsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });

  it('does not flag populated fields', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Email', tagId: 't1', tagName: 'Person', inferredDataType: 'email', targetSupertagId: null, order: 0 },
    ];
    schema.tagApplications = [{ tagId: 't1', instanceCount: 10 }];
    schema.fieldValues = [{ fieldName: 'Email', tagId: 't1', populatedCount: 8, totalInstances: 10, fillRate: 80 }];

    const findings = unusedFieldsDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });
});

// ── Fill Rate ──────────────────────────────────────────────

describe('fill-rate detector', () => {
  it('finds fields below 10% fill rate', () => {
    const schema = createEmptySchema();
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Phone', tagId: 't1', tagName: 'Person', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
    ];
    schema.fieldValues = [{ fieldName: 'Phone', tagId: 't1', populatedCount: 1, totalInstances: 20, fillRate: 5 }];

    const findings = fillRateDetector.detect(schema);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].details.fillRate).toBe(5);
  });

  it('does not flag fields at exactly 10%', () => {
    const schema = createEmptySchema();
    schema.fieldValues = [{ fieldName: 'Phone', tagId: 't1', populatedCount: 1, totalInstances: 10, fillRate: 10 }];

    const findings = fillRateDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });

  it('does not flag fields with zero fill (unused detector handles those)', () => {
    const schema = createEmptySchema();
    schema.fieldValues = [{ fieldName: 'Phone', tagId: 't1', populatedCount: 0, totalInstances: 10, fillRate: 0 }];

    const findings = fillRateDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });
});

// ── Missing Inheritance ────────────────────────────────────

describe('missing-inheritance detector', () => {
  it('detects tags sharing 3+ fields without common parent', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Person', normalizedName: 'person', description: null, color: null, instanceCount: 10, lastUsed: null },
      { id: 't2', name: 'Company', normalizedName: 'company', description: null, color: null, instanceCount: 5, lastUsed: null },
      { id: 't3', name: 'Meeting', normalizedName: 'meeting', description: null, color: null, instanceCount: 8, lastUsed: null },
      { id: 't4', name: 'Project', normalizedName: 'project', description: null, color: null, instanceCount: 12, lastUsed: null },
      { id: 't5', name: 'Task', normalizedName: 'task', description: null, color: null, instanceCount: 20, lastUsed: null },
    ];
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Name', tagId: 't1', tagName: 'Person', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Email', tagId: 't1', tagName: 'Person', inferredDataType: 'email', targetSupertagId: null, order: 1 },
      { fieldLabelId: 'f3', fieldName: 'Phone', tagId: 't1', tagName: 'Person', inferredDataType: 'plain', targetSupertagId: null, order: 2 },
      { fieldLabelId: 'f4', fieldName: 'Name', tagId: 't2', tagName: 'Company', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f5', fieldName: 'Email', tagId: 't2', tagName: 'Company', inferredDataType: 'email', targetSupertagId: null, order: 1 },
      { fieldLabelId: 'f6', fieldName: 'Phone', tagId: 't2', tagName: 'Company', inferredDataType: 'plain', targetSupertagId: null, order: 2 },
    ];

    const findings = missingInheritanceDetector.detect(schema);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('share 3 fields');
  });

  it('skips when workspace has fewer than 5 tags', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Person', normalizedName: 'person', description: null, color: null, instanceCount: 10, lastUsed: null },
      { id: 't2', name: 'Company', normalizedName: 'company', description: null, color: null, instanceCount: 5, lastUsed: null },
    ];

    const findings = missingInheritanceDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });

  it('does not flag tags with common parent', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 'p', name: 'Entity', normalizedName: 'entity', description: null, color: null, instanceCount: 0, lastUsed: null },
      { id: 't1', name: 'Person', normalizedName: 'person', description: null, color: null, instanceCount: 10, lastUsed: null },
      { id: 't2', name: 'Company', normalizedName: 'company', description: null, color: null, instanceCount: 5, lastUsed: null },
      { id: 't3', name: 'Meeting', normalizedName: 'meeting', description: null, color: null, instanceCount: 8, lastUsed: null },
      { id: 't4', name: 'Project', normalizedName: 'project', description: null, color: null, instanceCount: 12, lastUsed: null },
    ];
    schema.fields = [
      { fieldLabelId: 'f1', fieldName: 'Name', tagId: 't1', tagName: 'Person', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Email', tagId: 't1', tagName: 'Person', inferredDataType: 'email', targetSupertagId: null, order: 1 },
      { fieldLabelId: 'f3', fieldName: 'Phone', tagId: 't1', tagName: 'Person', inferredDataType: 'plain', targetSupertagId: null, order: 2 },
      { fieldLabelId: 'f4', fieldName: 'Name', tagId: 't2', tagName: 'Company', inferredDataType: 'plain', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f5', fieldName: 'Email', tagId: 't2', tagName: 'Company', inferredDataType: 'email', targetSupertagId: null, order: 1 },
      { fieldLabelId: 'f6', fieldName: 'Phone', tagId: 't2', tagName: 'Company', inferredDataType: 'plain', targetSupertagId: null, order: 2 },
    ];
    // Both extend Entity
    schema.inheritance = [
      { childTagId: 't1', parentTagId: 'p' },
      { childTagId: 't2', parentTagId: 'p' },
    ];

    const findings = missingInheritanceDetector.detect(schema);
    expect(findings).toHaveLength(0);
  });
});

// ── Detector Registry ──────────────────────────────────────

describe('runDetectors', () => {
  it('runs all detectors by default', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Orphan', normalizedName: 'orphan', description: null, color: null, instanceCount: 0, lastUsed: null },
    ];

    const findings = runDetectors(schema);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].detector).toBe('orphan-tags');
  });

  it('filters by detector names', () => {
    const schema = createEmptySchema();
    schema.supertags = [
      { id: 't1', name: 'Orphan', normalizedName: 'orphan', description: null, color: null, instanceCount: 0, lastUsed: null },
      { id: 't2', name: 'LowUsage', normalizedName: 'lowusage', description: null, color: null, instanceCount: 1, lastUsed: null },
    ];

    const findings = runDetectors(schema, { detectors: ['low-usage-tags'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].detector).toBe('low-usage-tags');
  });

  it('returns empty for empty schema', () => {
    const schema = createEmptySchema();
    const findings = runDetectors(schema);
    expect(findings).toHaveLength(0);
  });
});
