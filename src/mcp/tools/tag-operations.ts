/**
 * MCP Tools: tana_tag_add, tana_tag_remove
 * Add or remove tags from nodes
 * Spec: F-094, Task: T-5.4
 */
import { resolveBackend } from '../../api/backend-resolver';
import { resolveTagIds, TAG_ACTION_LABELS, type TagMutationDeps } from '../../services/tag-id-resolver';
import { handleMcpError } from '../error-handler';

async function changeTags(
  action: 'add' | 'remove',
  args: { nodeId: string; tagIds: string[] },
  deps: TagMutationDeps,
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
    const labels = TAG_ACTION_LABELS[action];
    const lines = [`${failed ? labels.failed : labels.done} tags ${labels.preposition} ${result.nodeName} (${result.nodeId}):`];
    for (const r of result.results) {
      lines.push(`  ${r.success ? labels.mark : '!'} ${r.tagName || r.tagId}: ${r.message}`);
    }
    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
      ...(failed ? { isError: true } : {}),
    };
  } catch (error) {
    return handleMcpError(error);
  }
}

export async function handleTagAdd(args: { nodeId: string; tagIds: string[] }, deps: TagMutationDeps = {}) {
  return changeTags('add', args, deps);
}

export async function handleTagRemove(args: { nodeId: string; tagIds: string[] }, deps: TagMutationDeps = {}) {
  return changeTags('remove', args, deps);
}
