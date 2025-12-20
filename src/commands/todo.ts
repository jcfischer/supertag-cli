/**
 * Todo Command
 * Creates Todo nodes in Tana with proper field structure
 */

import { readStdin, hasStdinData } from '../parsers/stdin';
import { parseJsonSmart } from '../parsers/json';
import { createTodoNode, parseTodoFromJson } from '../formatters/todo';
import { getFunctionStatusFieldName } from '../formatters/functionStatus';
import { createApiClient } from '../api/client';
import { getConfig } from '../config/manager';
import { exitWithError, ParseError, ConfigError } from '../utils/errors';
import type { TodoOptions, TodoInput } from '../types';

/**
 * Execute todo command
 * @param name Todo name (if provided as argument)
 * @param options Todo command options
 */
export async function todoCommand(name: string | undefined, options: TodoOptions): Promise<void> {
  try {
    // Load configuration
    const configManager = getConfig();
    const config = configManager.getConfig();

    // Get API token (CLI flag > env var > config file)
    const apiToken = options.token || config.apiToken;
    if (!apiToken) {
      throw new ConfigError(
        'API token not configured. Set it via:\n\n' +
        '  Environment variable:\n' +
        '    export TANA_API_TOKEN="your_token_here"\n\n' +
        '  Config file:\n' +
        '    tana config --token your_token_here\n\n' +
        '  CLI flag:\n' +
        '    tana todo "Task name" --token your_token_here\n\n' +
        'Get your token from: https://app.tana.inc/?bundle=settings&panel=api'
      );
    }

    // Get target node (CLI flag > env var > config file > default)
    const targetNode = options.target || config.defaultTargetNode;

    // Get API endpoint
    const apiEndpoint = config.apiEndpoint;

    if (options.verbose) {
      console.error('⚙️  Configuration:');
      console.error(`   Endpoint: ${apiEndpoint}`);
      console.error(`   Target: ${targetNode}`);
      console.error(`   Dry run: ${options.dryRun ? 'yes' : 'no'}`);
      console.error('');
    }

    // Determine input source: CLI args or stdin
    let todoInput: TodoInput;

    if (name) {
      // Create from CLI arguments
      todoInput = {
        name,
        status: options.status,
        dueDate: options.dueDate,
        doDate: options.doDate,
        focus: options.focus,
        vault: options.vault,
        parent: options.parent,
      };

      if (options.verbose) {
        console.error('📝 Creating todo from CLI arguments...');
      }
    } else if (hasStdinData()) {
      // Read from stdin (JSON)
      const input = await readStdin();

      if (options.verbose) {
        console.error('📄 Parsing JSON input...');
      }

      const json = parseJsonSmart(input);

      // Handle array or single object
      if (Array.isArray(json)) {
        if (json.length === 0) {
          throw new ParseError('Empty array provided');
        }
        if (json.length > 1) {
          throw new ParseError(
            'Multiple todos in array not supported yet. Please post one at a time.'
          );
        }
        todoInput = parseTodoFromJson(json[0] as Record<string, unknown>);
      } else {
        todoInput = parseTodoFromJson(json as Record<string, unknown>);
      }

      // Override with CLI options if provided
      if (options.status) todoInput.status = options.status;
      if (options.dueDate) todoInput.dueDate = options.dueDate;
      if (options.doDate) todoInput.doDate = options.doDate;
      if (options.focus) todoInput.focus = options.focus;
      if (options.vault) todoInput.vault = options.vault;
      if (options.parent) todoInput.parent = options.parent;

    } else {
      throw new ParseError(
        'No input provided. Usage:\n\n' +
        '  From CLI:\n' +
        '    tana todo "Buy groceries" --do-date 2025-11-30 --focus "5mrLejJyd6ih"\n\n' +
        '  From JSON:\n' +
        '    echo \'{"name": "Buy groceries", "doDate": "2025-11-30"}\' | tana todo\n' +
        '    cat todos.json | tana todo'
      );
    }

    // Create Todo node
    const todoNode = createTodoNode(todoInput);

    if (options.verbose) {
      console.error(`   Todo: ${todoInput.name}`);
      if (todoInput.status) console.error(`   Status: ${todoInput.status}`);
      if (todoInput.dueDate) console.error(`   Due Date: ${todoInput.dueDate}`);
      if (todoInput.doDate) console.error(`   Do Date: ${todoInput.doDate}`);
      if (todoInput.focus) console.error(`   Focus: ${todoInput.focus}`);
      if (todoInput.vault) console.error(`   Vault: ${todoInput.vault}`);
      if (todoInput.parent) console.error(`   Parent: ${todoInput.parent}`);
      console.error('');
    }

    // Dry run mode - just show what would be posted
    if (options.dryRun) {
      console.error('🔍 DRY RUN MODE - Not posting to API');
      console.error('');
      console.error('Would create the following Todo:');
      console.error('');
      console.error(`📝 ${todoInput.name}`);
      if (todoInput.description) {
        console.error(`   Description: ${todoInput.description}`);
      }
      if (todoNode.children && todoNode.children.length > 0) {
        console.error('   Fields:');
        for (const child of todoNode.children) {
          if ('type' in child && child.type === 'field' && child.attributeId) {
            const fieldName = getFieldName(child.attributeId);
            if (child.children && child.children.length > 0) {
              const firstChild = child.children[0];
              if ('name' in firstChild) {
                console.error(`   - ${fieldName}: ${firstChild.name}`);
              }
            }
          }
        }
      }
      console.error('');
      console.error('✅ Validation passed - ready to post');
      console.error('');
      console.error('To actually post, remove the --dry-run flag');
      return;
    }

    // Create API client and post
    const client = createApiClient(apiToken, apiEndpoint);
    const response = await client.postNodes(targetNode, [todoNode], options.verbose);

    if (response.success) {
      console.log('✅ Todo created successfully in Tana');
      if (response.nodeIds && response.nodeIds.length > 0) {
        console.log(`   Node ID: ${response.nodeIds[0]}`);
      }
    } else {
      throw new Error('API returned success: false');
    }

  } catch (error) {
    exitWithError(error);
  }
}

/**
 * Get human-readable field name from attribute ID
 * @param attributeId Attribute ID
 * @returns Field name
 */
function getFieldName(attributeId: string): string {
  // Try Function|Status fields first
  const functionStatusName = getFunctionStatusFieldName(attributeId);
  if (!functionStatusName.startsWith('Field ')) {
    return functionStatusName;
  }

  // Try Todo-specific fields
  const todoFieldMap: Record<string, string> = {
    'TIw94EJ5T-': 'Parent',
    'qFXubn29lX': 'Do Date',
    'hjg_UYqw70ot': 'Vault',
    'k6q151wjIv5E': 'Focus',
  };

  return todoFieldMap[attributeId] || `Field ${attributeId}`;
}
