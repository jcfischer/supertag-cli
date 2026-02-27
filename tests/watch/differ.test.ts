/**
 * Snapshot Differ Tests (F-103 T-1.3)
 */

import { describe, test, expect } from "bun:test";
import { diffSnapshots } from "../../src/watch/differ";
import type { NodeSnapshot } from "../../src/watch/types";

function makeSnapshot(nodes: NodeSnapshot[]): Map<string, NodeSnapshot> {
  return new Map(nodes.map(n => [n.id, n]));
}

function makeNode(id: string, name: string, tags: string[] = [], updatedAt = 1000): NodeSnapshot {
  return { id, name, tags, updatedAt };
}

describe("diffSnapshots - empty snapshots", () => {
  test("both empty returns empty array", () => {
    const result = diffSnapshots(new Map(), new Map(), 1);
    expect(result).toEqual([]);
  });

  test("empty before, empty after returns empty array", () => {
    const result = diffSnapshots(makeSnapshot([]), makeSnapshot([]), 1);
    expect(result).toEqual([]);
  });
});

describe("diffSnapshots - creates", () => {
  test("node in after but not before is a create", () => {
    const before = makeSnapshot([]);
    const after = makeSnapshot([makeNode('n1', 'New Node', ['meeting'])]);

    const events = diffSnapshots(before, after, 5);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('create');
    expect(events[0].node.id).toBe('n1');
    expect(events[0].node.name).toBe('New Node');
    expect(events[0].node.tags).toEqual(['meeting']);
    expect(events[0].pollCycle).toBe(5);
    expect(events[0].timestamp).toBeDefined();
    expect(events[0].changes).toBeUndefined();
  });

  test("multiple creates", () => {
    const before = makeSnapshot([]);
    const after = makeSnapshot([
      makeNode('n1', 'Node 1'),
      makeNode('n2', 'Node 2'),
    ]);

    const events = diffSnapshots(before, after, 1);
    const creates = events.filter(e => e.type === 'create');
    expect(creates.length).toBe(2);
  });
});

describe("diffSnapshots - modifies", () => {
  test("name change is a modify with name diff", () => {
    const before = makeSnapshot([makeNode('n1', 'Old Name', ['meeting'], 1000)]);
    const after = makeSnapshot([makeNode('n1', 'New Name', ['meeting'], 1000)]);

    const events = diffSnapshots(before, after, 2);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('modify');
    expect(events[0].node.id).toBe('n1');
    expect(events[0].changes?.name).toEqual({ before: 'Old Name', after: 'New Name' });
  });

  test("updatedAt change is a modify", () => {
    const before = makeSnapshot([makeNode('n1', 'Node', [], 1000)]);
    const after = makeSnapshot([makeNode('n1', 'Node', [], 2000)]);

    const events = diffSnapshots(before, after, 3);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('modify');
  });

  test("tag added is a modify with tags diff", () => {
    const before = makeSnapshot([makeNode('n1', 'Node', ['meeting'], 1000)]);
    const after = makeSnapshot([makeNode('n1', 'Node', ['meeting', 'completed'], 1000)]);

    const events = diffSnapshots(before, after, 4);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('modify');
    expect(events[0].changes?.tags?.added).toContain('completed');
    expect(events[0].changes?.tags?.removed).toEqual([]);
  });

  test("tag removed is a modify with tags diff", () => {
    const before = makeSnapshot([makeNode('n1', 'Node', ['meeting', 'active'], 1000)]);
    const after = makeSnapshot([makeNode('n1', 'Node', ['meeting'], 1000)]);

    const events = diffSnapshots(before, after, 4);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('modify');
    expect(events[0].changes?.tags?.added).toEqual([]);
    expect(events[0].changes?.tags?.removed).toContain('active');
  });

  test("no changes returns empty array", () => {
    const before = makeSnapshot([makeNode('n1', 'Node', ['meeting'], 1000)]);
    const after = makeSnapshot([makeNode('n1', 'Node', ['meeting'], 1000)]);

    const events = diffSnapshots(before, after, 5);
    expect(events).toEqual([]);
  });

  test("only name in changes when only name changed", () => {
    const before = makeSnapshot([makeNode('n1', 'Before', ['tag1'], 1000)]);
    const after = makeSnapshot([makeNode('n1', 'After', ['tag1'], 1000)]);

    const events = diffSnapshots(before, after, 6);
    expect(events[0].changes?.name).toBeDefined();
    expect(events[0].changes?.tags).toBeUndefined();
  });
});

describe("diffSnapshots - deletes", () => {
  test("node in before but not after is a delete", () => {
    const before = makeSnapshot([makeNode('n1', 'Deleted Node', ['meeting'])]);
    const after = makeSnapshot([]);

    const events = diffSnapshots(before, after, 7);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('delete');
    expect(events[0].node.id).toBe('n1');
    expect(events[0].node.name).toBe('Deleted Node');
    expect(events[0].changes).toBeUndefined();
  });
});

describe("diffSnapshots - mixed batch", () => {
  test("create, modify, and delete in same cycle", () => {
    const before = makeSnapshot([
      makeNode('existing', 'Existing', ['tag1'], 1000),
      makeNode('todelete', 'To Delete', [], 1000),
    ]);
    const after = makeSnapshot([
      makeNode('existing', 'Modified', ['tag1'], 2000),
      makeNode('newnode', 'New Node', ['tag2'], 3000),
    ]);

    const events = diffSnapshots(before, after, 8);
    const types = events.map(e => e.type).sort();
    expect(types).toEqual(['create', 'delete', 'modify']);
  });

  test("unchanged nodes do not appear in events", () => {
    const before = makeSnapshot([
      makeNode('unchanged', 'Same', ['tag'], 1000),
      makeNode('changed', 'Old', [], 1000),
    ]);
    const after = makeSnapshot([
      makeNode('unchanged', 'Same', ['tag'], 1000),
      makeNode('changed', 'New', [], 2000),
    ]);

    const events = diffSnapshots(before, after, 9);
    expect(events.length).toBe(1);
    expect(events[0].node.id).toBe('changed');
  });
});

describe("diffSnapshots - pollCycle", () => {
  test("pollCycle is set correctly on all event types", () => {
    const before = makeSnapshot([makeNode('del', 'Delete Me', []), makeNode('mod', 'Modify Me', [])]);
    const after = makeSnapshot([makeNode('mod', 'Modified', []), makeNode('cre', 'Created', [])]);

    const events = diffSnapshots(before, after, 42);
    for (const event of events) {
      expect(event.pollCycle).toBe(42);
    }
  });
});
