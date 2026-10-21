/**
 * Tag Mutation Command - Add/remove tags on nodes, create new supertags
 * Spec: F-094 tana-local API Integration
 * Tasks: T-4.4, T-4.5
 *
 * Note: This is `supertag tag` (singular, mutations).
 * Different from `supertag tags` (plural, queries).
 */
import { Command } from 'commander';
import { resolveBackend } from '../api/backend-resolver';
import type { TanaBackend } from '../api/backend';
import { resolveTagIds } from '../services/tag-id-resolver';
import { exitWithError } from '../utils/errors';

export interface TagChangeDeps {
  backend?: Pick<TanaBackend, 'supportsMutations' | 'addTags' | 'removeTags'>;
  /** Workspace database used for name resolution (default: default workspace) */
  dbPath?: string;
}

/**
 * Add or remove one tag on a node. Resolves a tag name to its ID unless
 * --tag-id is set. Returns the exit code: 1 when the tag was not applied.
 */
export async function runTagChange(
  action: 'add' | 'remove',
  nodeId: string,
  tagNameOrId: string,
  options: { tagId?: boolean },
  deps: TagChangeDeps = {},
): Promise<number> {
  const backend = deps.backend ?? await resolveBackend();
  if (!backend.supportsMutations()) {
    console.error('Error: Tag operations require the local API backend.');
    console.error('Configure with: supertag config --bearer-token <token>');
    return 1;
  }

  const [tagId] = options.tagId ? [tagNameOrId] : resolveTagIds([tagNameOrId], deps.dbPath);
  const result = action === 'add'
    ? await backend.addTags(nodeId, [tagId])
    : await backend.removeTags(nodeId, [tagId]);

  const failed = result.results.some((r) => !r.success);
  const print = failed ? console.error : console.log;
  const verb = action === 'add' ? 'add tag to' : 'remove tag from';
  print(failed
    ? `Failed to ${verb} ${result.nodeName} (${result.nodeId}):`
    : `${action === 'add' ? 'Added tag to' : 'Removed tag from'} ${result.nodeName} (${result.nodeId}):`);
  for (const r of result.results) {
    const status = r.success ? (action === 'add' ? '  +' : '  -') : '  !';
    print(`${status} ${r.tagName || r.tagId}: ${r.message}`);
  }
  return failed ? 1 : 0;
}

export function createTagCommand(): Command {
  const tag = new Command('tag');
  tag.description('Tag operations: add/remove tags on nodes, create new supertags (requires local API)');

  // supertag tag add <nodeId> <tagNameOrId>
  tag
    .command('add <nodeId> <tagNameOrId>')
    .description('Add a tag to a node (by name or ID)')
    .option('--tag-id', 'Treat the second argument as a tag ID (skip name resolution)')
    .action(async (nodeId: string, tagNameOrId: string, options: { tagId?: boolean }) => {
      try {
        process.exit(await runTagChange('add', nodeId, tagNameOrId, options));
      } catch (error) {
        exitWithError(error);
      }
    });

  // supertag tag remove <nodeId> <tagNameOrId>
  tag
    .command('remove <nodeId> <tagNameOrId>')
    .description('Remove a tag from a node (by name or ID)')
    .option('--tag-id', 'Treat the second argument as a tag ID (skip name resolution)')
    .action(async (nodeId: string, tagNameOrId: string, options: { tagId?: boolean }) => {
      try {
        process.exit(await runTagChange('remove', nodeId, tagNameOrId, options));
      } catch (error) {
        exitWithError(error);
      }
    });

  // supertag tag create <name>
  // This one needs direct access to the LocalApiClient since createTag isn't on TanaBackend
  tag
    .command('create <name>')
    .description('Create a new supertag')
    .option('--description <text>', 'Tag description')
    .option('--extends <tagId>', 'Extend from an existing tag (by ID)')
    .option('--checkbox', 'Enable done checkbox on nodes with this tag')
    .option('--workspace <id>', 'Workspace ID (uses first workspace by default)')
    .action(async (name: string, options: { description?: string; extends?: string; checkbox?: boolean; workspace?: string }) => {
      try {
        // For tag creation, we need the LocalApiClient directly
        const { ConfigManager } = await import('../config/manager');
        const { LocalApiClient } = await import('../api/local-api-client');

        const configManager = ConfigManager.getInstance();
        const localApiConfig = configManager.getLocalApiConfig();

        if (!localApiConfig.bearerToken) {
          console.error('Error: Tag creation requires a local API bearer token.');
          console.error('Configure with: supertag config --bearer-token <token>');
          process.exit(1);
        }

        const client = new LocalApiClient({
          endpoint: localApiConfig.endpoint,
          bearerToken: localApiConfig.bearerToken,
        });

        // Get workspace ID
        let workspaceId = options.workspace;
        if (!workspaceId) {
          const workspaces = await client.listWorkspaces();
          if (workspaces.length === 0) {
            console.error('Error: No workspaces found');
            process.exit(1);
          }
          workspaceId = workspaces[0].id;
        }

        const result = await client.createTag(workspaceId, {
          name,
          description: options.description,
          extendsTagIds: options.extends ? [options.extends] : [],
          showCheckbox: options.checkbox,
        });

        console.log(`Created tag: ${result.tagName} (${result.tagId})`);
        if (result.extendsTagNames && result.extendsTagNames.length > 0) {
          console.log(`  Extends: ${result.extendsTagNames.join(', ')}`);
        }
      } catch (error) {
        exitWithError(error);
      }
    });

  return tag;
}
