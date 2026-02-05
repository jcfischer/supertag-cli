/**
 * tana_node Tool
 *
 * Show full contents of a specific node by ID, including fields, tags, and children.
 * Supports depth traversal for nested content.
 *
 * Refactored to use TanaReadBackend (F-097, T-4.2).
 * Routes through resolveReadBackend() which selects Local API or SQLite.
 */

import { Database } from 'bun:sqlite';
import { resolveReadBackend } from '../../api/read-backend-resolver.js';
import type { ReadNodeContent } from '../../api/read-backend.js';
import type { NodeInput } from '../schemas.js';
import {
  parseSelectPaths,
  applyProjection,
} from '../../utils/select-projection.js';
import { resolveEffectiveDepth } from '../../commands/show.js';
import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';

// ---------------------------------------------------------------------------
// Exported types (backward compatibility for batch-operations.ts)
// ---------------------------------------------------------------------------

interface FieldValue {
  fieldName: string;
  fieldId: string;
  value: string;
  valueId: string;
}

/**
 * NodeContents interface — kept for backward compatibility.
 * batch-operations.ts imports this type.
 */
export interface NodeContents {
  id: string;
  name: string;
  created: Date | null;
  tags: string[];
  fields: FieldValue[];
  children: NodeContents[];
}

// ---------------------------------------------------------------------------
// ReadNodeContent to output mapping
// ---------------------------------------------------------------------------

/**
 * Map ReadNodeContent from the read backend to a flat output shape.
 * Returns the canonical fields that MCP consumers expect.
 */
function mapReadNodeContentToOutput(content: ReadNodeContent): Record<string, unknown> {
  const output: Record<string, unknown> = {
    id: content.id,
    name: content.name,
    tags: content.tags || [],
    markdown: content.markdown,
  };

  if (content.description) {
    output.description = content.description;
  }

  if (content.children && content.children.length > 0) {
    output.children = content.children.map(mapReadNodeContentToOutput);
  } else {
    output.children = [];
  }

  return output;
}

// ---------------------------------------------------------------------------
// showNode
// ---------------------------------------------------------------------------

export async function showNode(input: NodeInput): Promise<Partial<Record<string, unknown>> | null> {
  const readBackend = await resolveReadBackend({ workspace: input.workspace });
  const requestedDepth = input.depth || 0;
  const depthExplicitlySet = input.depth !== undefined && input.depth !== null;

  // Smart depth: calendar/day pages auto-expand to depth 1 (SQLite backend only)
  let depth = requestedDepth;
  if (!readBackend.isLive() && !depthExplicitlySet) {
    try {
      const ws = resolveWorkspaceContext({ workspace: input.workspace });
      const db = new Database(ws.dbPath, { readonly: true });
      try {
        depth = resolveEffectiveDepth(db, input.nodeId, requestedDepth, depthExplicitlySet);
      } finally {
        db.close();
      }
    } catch {
      // DB unavailable — use requested depth
    }
  }

  try {
    const nodeContent = await readBackend.readNode(input.nodeId, depth);
    const result = mapReadNodeContentToOutput(nodeContent);

    // Apply field projection if select is specified
    const projection = parseSelectPaths(input.select);
    return applyProjection(result, projection);
  } catch (error) {
    if ((error as Error).message?.includes('not found')) {
      return null;
    }
    throw error;
  }
}
