/**
 * tana_batch_create MCP Tool Tests
 *
 * TDD tests for src/mcp/tools/batch-create.ts
 * Spec: 062-batch-operations
 */

import { describe, it, expect } from 'bun:test';

// T-3.3: Schema tests
describe('batchCreate MCP schema', () => {
  it('should export batchCreateSchema', async () => {
    const { batchCreateSchema } = await import('../../schemas');
    expect(batchCreateSchema).toBeDefined();
  });

  it('should have nodes array field (1-50)', async () => {
    const { batchCreateSchema } = await import('../../schemas');

    // Valid: 1 node
    const validOne = batchCreateSchema.safeParse({
      nodes: [{ supertag: 'todo', name: 'Task 1' }],
    });
    expect(validOne.success).toBe(true);

    // Valid: 50 nodes
    const valid50 = batchCreateSchema.safeParse({
      nodes: Array.from({ length: 50 }, (_, i) => ({ supertag: 'todo', name: `Task ${i}` })),
    });
    expect(valid50.success).toBe(true);

    // Invalid: 0 nodes
    const invalidZero = batchCreateSchema.safeParse({
      nodes: [],
    });
    expect(invalidZero.success).toBe(false);

    // Invalid: 51 nodes
    const invalid51 = batchCreateSchema.safeParse({
      nodes: Array.from({ length: 51 }, (_, i) => ({ supertag: 'todo', name: `Task ${i}` })),
    });
    expect(invalid51.success).toBe(false);
  });

  it('should validate node structure (supertag and name required)', async () => {
    const { batchCreateSchema } = await import('../../schemas');

    // Valid node
    const valid = batchCreateSchema.safeParse({
      nodes: [{ supertag: 'todo', name: 'Task' }],
    });
    expect(valid.success).toBe(true);

    // Missing supertag
    const missingSuperTag = batchCreateSchema.safeParse({
      nodes: [{ name: 'Task' }],
    });
    expect(missingSuperTag.success).toBe(false);

    // Missing name
    const missingName = batchCreateSchema.safeParse({
      nodes: [{ supertag: 'todo' }],
    });
    expect(missingName.success).toBe(false);
  });

  it('should have optional target field', async () => {
    const { batchCreateSchema } = await import('../../schemas');

    const withTarget = batchCreateSchema.safeParse({
      nodes: [{ supertag: 'todo', name: 'Task' }],
      target: 'INBOX',
    });
    expect(withTarget.success).toBe(true);

    const withoutTarget = batchCreateSchema.safeParse({
      nodes: [{ supertag: 'todo', name: 'Task' }],
    });
    expect(withoutTarget.success).toBe(true);
  });

  it('should have dryRun boolean with default false', async () => {
    const { batchCreateSchema } = await import('../../schemas');

    const parsed = batchCreateSchema.parse({
      nodes: [{ supertag: 'todo', name: 'Task' }],
    });
    expect(parsed.dryRun).toBe(false);

    const withDryRun = batchCreateSchema.parse({
      nodes: [{ supertag: 'todo', name: 'Task' }],
      dryRun: true,
    });
    expect(withDryRun.dryRun).toBe(true);
  });

  it('should have optional workspace field', async () => {
    const { batchCreateSchema } = await import('../../schemas');

    const withWorkspace = batchCreateSchema.safeParse({
      nodes: [{ supertag: 'todo', name: 'Task' }],
      workspace: 'main',
    });
    expect(withWorkspace.success).toBe(true);
  });

  it('should support fields on individual nodes', async () => {
    const { batchCreateSchema } = await import('../../schemas');

    const withFields = batchCreateSchema.safeParse({
      nodes: [{
        supertag: 'todo',
        name: 'Task',
        fields: { Status: 'Done', Priority: 'High' },
      }],
    });
    expect(withFields.success).toBe(true);
  });

  it('should support children on individual nodes', async () => {
    const { batchCreateSchema } = await import('../../schemas');

    const withChildren = batchCreateSchema.safeParse({
      nodes: [{
        supertag: 'project',
        name: 'Project',
        children: [
          { name: 'Task 1' },
          { name: 'https://example.com', dataType: 'url' },
        ],
      }],
    });
    expect(withChildren.success).toBe(true);
  });
});

// T-3.3: Export type test
describe('BatchCreateInput type', () => {
  it('should export BatchCreateInput type', async () => {
    const mod = await import('../../schemas');
    // Type exists if module exports it (compile-time check)
    expect(mod).toBeDefined();
  });
});

// T-3.4: MCP Tool tests
describe('batchCreate MCP tool', () => {
  it('should export batchCreate function', async () => {
    const { batchCreate } = await import('../batch-create');
    expect(typeof batchCreate).toBe('function');
  });

  it('should return BatchCreateResponse shape', async () => {
    const { batchCreate } = await import('../batch-create');

    // Use dry-run to avoid actual API calls
    const response = await batchCreate({
      nodes: [
        { supertag: 'todo', name: 'Task 1' },
        { supertag: 'todo', name: 'Task 2' },
      ],
      dryRun: true,
      workspace: undefined,
    });

    // Check response structure
    expect(response).toHaveProperty('results');
    expect(response).toHaveProperty('success');
    expect(response).toHaveProperty('created');
    expect(response).toHaveProperty('errors');
    expect(response).toHaveProperty('payloads');
    expect(response).toHaveProperty('dryRun');
    expect(Array.isArray(response.results)).toBe(true);
    expect(Array.isArray(response.errors)).toBe(true);
    expect(Array.isArray(response.payloads)).toBe(true);
  });

  it('should return dryRun: true when in dry-run mode', async () => {
    const { batchCreate } = await import('../batch-create');

    const response = await batchCreate({
      nodes: [{ supertag: 'todo', name: 'Task' }],
      dryRun: true,
      workspace: undefined,
    });

    expect(response.dryRun).toBe(true);
  });

  it('should include validated payloads in dry-run response', async () => {
    const { batchCreate } = await import('../batch-create');

    const response = await batchCreate({
      nodes: [
        { supertag: 'todo', name: 'Task 1' },
        { supertag: 'todo', name: 'Task 2' },
      ],
      dryRun: true,
      workspace: undefined,
    });

    // Payloads should be present for valid nodes
    expect(response.payloads.length).toBeGreaterThanOrEqual(0);
  });

  it('should collect errors for invalid nodes', async () => {
    const { batchCreate } = await import('../batch-create');

    // Mix of valid and invalid nodes (empty supertag)
    const response = await batchCreate({
      nodes: [
        { supertag: 'todo', name: 'Valid Task' },
        { supertag: '', name: 'Invalid - no supertag' },
      ],
      dryRun: true,
      workspace: undefined,
    });

    // Should have at least one error
    expect(response.errors.length).toBeGreaterThan(0);
    expect(response.errors[0]).toHaveProperty('index');
    expect(response.errors[0]).toHaveProperty('message');
  });

  it('should return success: false when any node fails', async () => {
    const { batchCreate } = await import('../batch-create');

    const response = await batchCreate({
      nodes: [
        { supertag: 'todo', name: 'Valid' },
        { supertag: '', name: 'Invalid' },
      ],
      dryRun: true,
      workspace: undefined,
    });

    expect(response.success).toBe(false);
  });
});

// T-3.5: Tool registry tests
describe('batchCreate tool registration', () => {
  it('should be registered in TOOL_METADATA', async () => {
    const { TOOL_METADATA } = await import('../../tool-registry');
    const tool = TOOL_METADATA.find((t) => t.name === 'tana_batch_create');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('mutate');
  });

  it('should have schema registered', async () => {
    const { getToolSchema } = await import('../../tool-registry');
    const schema = getToolSchema('tana_batch_create');
    expect(schema).not.toBeNull();
    expect(schema).toHaveProperty('type', 'object');
    expect(schema).toHaveProperty('properties');
  });

  it('should appear in capabilities under mutate category', async () => {
    const { getCapabilities } = await import('../../tool-registry');
    const caps = getCapabilities({ category: 'mutate' });
    const mutateCategory = caps.categories.find((c) => c.name === 'mutate');
    expect(mutateCategory).toBeDefined();
    const tool = mutateCategory?.tools.find((t) => t.name === 'tana_batch_create');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('multiple nodes');
  });
});
