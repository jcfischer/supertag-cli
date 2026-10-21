/**
 * Set-Field Command - Set field values on existing nodes
 * Spec: F-094 tana-local API Integration
 * Task: T-4.6
 */
import { Command } from 'commander';
import { resolveBackend } from '../api/backend-resolver';
import type { TanaBackend } from '../api/backend';
import type { FieldSetMode } from '../types/local-api';
import { resolveFieldId } from '../services/field-id-resolver';
import { defaultWorkspaceDbPath } from '../config/workspace-resolver';
import { exitWithError } from '../utils/errors';

export interface SetFieldDeps {
  backend?: Pick<TanaBackend, 'supportsMutations' | 'setFieldContent' | 'setFieldOption'>;
  /** Workspace database used for field name resolution (default: default workspace) */
  dbPath?: string;
}

export interface SetFieldOptions {
  fieldId?: string;
  optionId?: string;
  append?: boolean;
}

/**
 * Set a content or option field on a node. Returns the exit code.
 */
export async function runSetField(
  nodeId: string,
  fieldName: string,
  value: string | undefined,
  options: SetFieldOptions,
  deps: SetFieldDeps = {},
): Promise<number> {
  // The value and --option-id forms are alternatives; combining them is ambiguous (#110)
  if (options.optionId && value !== undefined) {
    console.error('Error: Pass either a field value or --option-id <id>, not both.');
    return 1;
  }
  if (!options.optionId && value === undefined) {
    console.error('Error: Field value is required unless --option-id is used.');
    return 1;
  }

  let attributeId = options.fieldId;
  let unresolvedName = false;
  if (!attributeId) {
    const resolution = resolveFieldId(nodeId, fieldName, deps.dbPath ?? defaultWorkspaceDbPath());
    if (resolution.kind === 'ambiguous') {
      console.error(`Error: Field "${fieldName}" matches several fields. Pass one with --field-id <id>:`);
      for (const candidate of resolution.candidates) {
        console.error(`  ${candidate.attributeId}  (#${candidate.tagName})`);
      }
      return 1;
    }
    // Unknown names pass through: the argument may be an attribute ID the index lacks
    attributeId = resolution.kind === 'resolved' ? resolution.attributeId : fieldName;
    unresolvedName = resolution.kind === 'unknown';
  }

  const backend = deps.backend ?? await resolveBackend();
  if (!backend.supportsMutations()) {
    console.error('Error: Setting fields requires the local API backend.');
    console.error('Configure with: supertag config --bearer-token <token>');
    return 1;
  }

  const mode: FieldSetMode = options.append ? 'append' : 'replace';

  try {
    return await writeField(backend, nodeId, attributeId, value, options, mode);
  } catch (error) {
    if (unresolvedName) {
      console.error(`Hint: "${fieldName}" is not a known field name or attribute ID in the local index.`);
      console.error('Pass the field\'s attribute ID with --field-id <id>, or run supertag sync if the field is new.');
    }
    throw error;
  }
}

async function writeField(
  backend: NonNullable<SetFieldDeps['backend']>,
  nodeId: string,
  attributeId: string,
  value: string | undefined,
  options: SetFieldOptions,
  mode: FieldSetMode,
): Promise<number> {
  if (options.optionId) {
    // Option field
    const result = await backend.setFieldOption(nodeId, attributeId, options.optionId, mode);
    if (result.optionId !== options.optionId) {
      console.error(`Error: Requested option ${options.optionId}, but the field now holds ${result.optionName} (${result.optionId}).`);
      return 1;
    }
    console.log(`${mode === 'append' ? 'Appended option to' : 'Set option field on'} node ${result.nodeId}`);
    console.log(`  Field: ${result.attributeId}`);
    console.log(`  Option: ${result.optionName}`);
  } else {
    // Content field (text, number, date, url, email)
    const result = await backend.setFieldContent(nodeId, attributeId, value!, mode);
    console.log(`${mode === 'append' ? 'Appended to field on' : 'Set field on'} node ${result.nodeId}`);
    console.log(`  Field: ${result.attributeId}`);
    console.log(`  Value: ${result.content}`);
  }
  return 0;
}

export function createSetFieldCommand(deps: SetFieldDeps = {}): Command {
  const setField = new Command('set-field');
  setField
    .description('Set or append a field value on an existing node (requires local API)')
    .argument('<nodeId>', 'Node ID to update')
    .argument('<fieldName>', 'Field name (resolved via the index) or attribute ID')
    .argument('[value]', 'Field value to set (omit when --option-id is used)')
    .option('--field-id <id>', 'Use attribute ID directly (bypass name resolution)')
    .option('--option-id <id>', 'Set as option field with this option ID (instead of a value)')
    .option('--append', 'Append to an existing multi-value field instead of replacing it')
    .action(async (nodeId: string, fieldName: string, value: string | undefined, options: SetFieldOptions) => {
      try {
        const code = await runSetField(nodeId, fieldName, value, options, deps);
        if (code !== 0) process.exit(code);
      } catch (error) {
        exitWithError(error);
      }
    });

  return setField;
}
