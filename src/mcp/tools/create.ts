/**
 * tana_create Tool
 *
 * Create new nodes in Tana via the Input API.
 * Supports dry-run mode for validation without posting.
 *
 * Uses shared node-builder module for validation and payload building.
 */

import { ConfigManager } from '../../config/manager.js';
import { resolveWorkspace } from '../../config/paths.js';
import { createNode } from '../../services/node-builder.js';
import type { CreateInput } from '../schemas.js';
import type { TanaApiNode, ChildNodeInput } from '../../types.js';

export interface CreateResult {
  workspace: string;
  supertag: string;
  name: string;
  target: string;
  dryRun: boolean;
  validated: boolean;
  payload: TanaApiNode;
  nodeId?: string;
  error?: string;
}

export async function create(input: CreateInput): Promise<CreateResult> {
  const configManager = ConfigManager.getInstance();
  const config = configManager.getConfig();
  const workspace = resolveWorkspace(input.workspace, config);

  // Validate supertag name
  if (!input.supertag || input.supertag.trim().length === 0) {
    throw new Error('Supertag name is required');
  }

  // Validate node name
  if (!input.name || input.name.trim().length === 0) {
    throw new Error('Node name is required');
  }

  // Convert MCP children format to shared ChildNodeInput format
  const children: ChildNodeInput[] | undefined = input.children?.map((child) => ({
    name: child.name,
    id: child.id,
    dataType: child.dataType as 'url' | 'reference' | undefined,
  }));

  // Use shared createNode function
  const nodeResult = await createNode({
    supertag: input.supertag,
    name: input.name,
    fields: input.fields,
    children,
    target: input.target,
    dryRun: input.dryRun,
  });

  // Transform to MCP-specific result format
  const result: CreateResult = {
    workspace: workspace.alias,
    supertag: input.supertag,
    name: input.name,
    target: nodeResult.target,
    dryRun: nodeResult.dryRun,
    validated: true,
    payload: nodeResult.payload,
    nodeId: nodeResult.nodeId,
    error: nodeResult.error,
  };

  // If the shared module returned an error but didn't throw, propagate it
  if (!nodeResult.success && nodeResult.error) {
    throw new Error(nodeResult.error);
  }

  return result;
}
