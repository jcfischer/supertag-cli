/**
 * MCP Tools: tana_tag_add, tana_tag_remove
 * Add or remove tags from nodes
 * Spec: F-094, Task: T-5.4
 */
import { resolveBackend } from '../../api/backend-resolver';
import type { TanaBackend } from '../../api/backend';
import { resolveTagIds } from '../../services/tag-id-resolver';
import { handleMcpError } from '../error-handler';

export interface TagOperationDeps {
  backend?: Pick<TanaBackend, 'supportsMutations' | 'addTags' | 'removeTags'>;
  /** Workspace database used for name resolution (default: default workspace) */
  dbPath?: string;
}

async function changeTags(
  action: 'add' | 'remove',
  args: { nodeId: string; tagIds: string[] },
  deps: TagOperationDeps,
) {
  try {
    const backend = deps.backend ?? await resolveBackend();
    if (!backend.supportsMutations()) {
      return {
        content: [{ type: 'text' as const, text: 'Error: Tag operations require the local API backend. Configure with: supertag config --bearer-token <token>' }],
        isError: true,
      };
    }

    // Accept tag names as well as IDs (#111)
    const tagIds = resolveTagIds(args.tagIds, deps.dbPath);
    const result = action === 'add'
      ? await backend.addTags(args.nodeId, tagIds)
      : await backend.removeTags(args.nodeId, tagIds);

    const failed = result.results.some((r) => !r.success);
    const header = failed
      ? `Failed to ${action === 'add' ? 'add tags to' : 'remove tags from'} ${result.nodeName} (${result.nodeId}):`
      : `${action === 'add' ? 'Added tags to' : 'Removed tags from'} ${result.nodeName} (${result.nodeId}):`;
    const lines = [header];
    for (const r of result.results) {
      lines.push(`  ${r.success ? (action === 'add' ? '+' : '-') : '!'} ${r.tagName || r.tagId}: ${r.message}`);
    }
    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
      ...(failed ? { isError: true } : {}),
    };
  } catch (error) {
    return handleMcpError(error);
  }
}

export async function handleTagAdd(args: { nodeId: string; tagIds: string[] }, deps: TagOperationDeps = {}) {
  return changeTags('add', args, deps);
}

export async function handleTagRemove(args: { nodeId: string; tagIds: string[] }, deps: TagOperationDeps = {}) {
  return changeTags('remove', args, deps);
}
