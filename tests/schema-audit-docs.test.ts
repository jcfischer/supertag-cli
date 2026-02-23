/**
 * Schema Audit Documentation Generator Tests (F-101)
 */

import { describe, it, expect } from 'bun:test';
import type { WorkspaceSchema } from '../src/types/schema-audit';
import { generateSchemaDocumentation } from '../src/services/schema-audit-docs';

function createTestSchema(): WorkspaceSchema {
  return {
    supertags: [
      { id: 't1', name: 'Person', normalizedName: 'person', description: 'A person', color: '#ff0000', instanceCount: 10, lastUsed: null },
      { id: 't2', name: 'Meeting', normalizedName: 'meeting', description: null, color: null, instanceCount: 5, lastUsed: null },
    ],
    fields: [
      { fieldLabelId: 'f1', fieldName: 'Email', tagId: 't1', tagName: 'Person', inferredDataType: 'email', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f2', fieldName: 'Role', tagId: 't1', tagName: 'Person', inferredDataType: 'options', targetSupertagId: null, order: 1 },
      { fieldLabelId: 'f3', fieldName: 'Date', tagId: 't2', tagName: 'Meeting', inferredDataType: 'date', targetSupertagId: null, order: 0 },
      { fieldLabelId: 'f4', fieldName: 'Attendees', tagId: 't2', tagName: 'Meeting', inferredDataType: 'instance', targetSupertagId: 't1', order: 1 },
    ],
    inheritance: [],
    tagApplications: [
      { tagId: 't1', instanceCount: 10 },
      { tagId: 't2', instanceCount: 5 },
    ],
    fieldValues: [
      { fieldName: 'Email', tagId: 't1', populatedCount: 9, totalInstances: 10, fillRate: 90 },
      { fieldName: 'Role', tagId: 't1', populatedCount: 7, totalInstances: 10, fillRate: 70 },
      { fieldName: 'Date', tagId: 't2', populatedCount: 5, totalInstances: 5, fillRate: 100 },
    ],
  };
}

describe('Schema Documentation Generator', () => {
  it('generates valid markdown', () => {
    const schema = createTestSchema();
    const docs = generateSchemaDocumentation(schema);

    expect(docs).toContain('# Workspace Schema Reference');
    expect(docs).toContain('## Person (#person)');
    expect(docs).toContain('## Meeting (#meeting)');
  });

  it('shows instance counts', () => {
    const schema = createTestSchema();
    const docs = generateSchemaDocumentation(schema);

    expect(docs).toContain('10 instances');
    expect(docs).toContain('5 instances');
  });

  it('includes fill rates', () => {
    const schema = createTestSchema();
    const docs = generateSchemaDocumentation(schema);

    expect(docs).toContain('90% filled');
    expect(docs).toContain('70% filled');
    expect(docs).toContain('100% filled');
  });

  it('includes field types', () => {
    const schema = createTestSchema();
    const docs = generateSchemaDocumentation(schema);

    expect(docs).toContain('(email)');
    expect(docs).toContain('(date)');
    expect(docs).toContain('(options)');
  });

  it('shows inheritance info', () => {
    const schema = createTestSchema();
    schema.inheritance = [{ childTagId: 't2', parentTagId: 't1' }];

    const docs = generateSchemaDocumentation(schema);
    expect(docs).toContain('Extends: Person');
  });

  it('shows cross-references (used by)', () => {
    const schema = createTestSchema();
    const docs = generateSchemaDocumentation(schema);

    // Person is referenced by Meeting.Attendees
    expect(docs).toContain('Used by: Meeting.Attendees');
  });

  it('handles empty schema', () => {
    const docs = generateSchemaDocumentation({
      supertags: [],
      fields: [],
      inheritance: [],
      tagApplications: [],
      fieldValues: [],
    });

    expect(docs).toContain('# Workspace Schema Reference');
  });

  it('sorts supertags by instance count descending', () => {
    const schema = createTestSchema();
    const docs = generateSchemaDocumentation(schema);

    const personPos = docs.indexOf('## Person');
    const meetingPos = docs.indexOf('## Meeting');
    // Person (10) should come before Meeting (5)
    expect(personPos).toBeLessThan(meetingPos);
  });
});
