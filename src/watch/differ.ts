/**
 * Snapshot Differ (F-103 T-1.3)
 *
 * Compares pre/post sync snapshots to detect creates, modifies, and deletes.
 */

import type { ChangeEvent, NodeSnapshot } from "./types";

/**
 * Diff two snapshots to produce a list of change events.
 *
 * @param before - Snapshot taken before sync
 * @param after - Snapshot taken after sync
 * @param pollCycle - Current poll cycle number (monotonic counter)
 * @returns Array of ChangeEvent objects
 */
export function diffSnapshots(
  before: Map<string, NodeSnapshot>,
  after: Map<string, NodeSnapshot>,
  pollCycle: number,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const timestamp = new Date().toISOString();

  // Detect creates: in after but not before
  for (const [id, afterNode] of after) {
    if (!before.has(id)) {
      events.push({
        type: 'create',
        timestamp,
        pollCycle,
        node: {
          id: afterNode.id,
          name: afterNode.name,
          tags: afterNode.tags,
        },
      });
    }
  }

  // Detect modifies: in both, but something changed
  for (const [id, afterNode] of after) {
    const beforeNode = before.get(id);
    if (!beforeNode) continue;

    const nameChanged = beforeNode.name !== afterNode.name;
    const updatedAtChanged = beforeNode.updatedAt !== afterNode.updatedAt;
    const tagsChanged = !arraysEqual(beforeNode.tags.sort(), afterNode.tags.sort());

    if (nameChanged || updatedAtChanged || tagsChanged) {
      const changes: ChangeEvent['changes'] = {};

      if (nameChanged) {
        changes.name = { before: beforeNode.name, after: afterNode.name };
      }

      if (tagsChanged) {
        const beforeSet = new Set(beforeNode.tags);
        const afterSet = new Set(afterNode.tags);
        changes.tags = {
          added: afterNode.tags.filter(t => !beforeSet.has(t)),
          removed: beforeNode.tags.filter(t => !afterSet.has(t)),
        };
      }

      events.push({
        type: 'modify',
        timestamp,
        pollCycle,
        node: {
          id: afterNode.id,
          name: afterNode.name,
          tags: afterNode.tags,
        },
        changes,
      });
    }
  }

  // Detect deletes: in before but not after
  for (const [id, beforeNode] of before) {
    if (!after.has(id)) {
      events.push({
        type: 'delete',
        timestamp,
        pollCycle,
        node: {
          id: beforeNode.id,
          name: beforeNode.name,
          tags: beforeNode.tags,
        },
      });
    }
  }

  return events;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
