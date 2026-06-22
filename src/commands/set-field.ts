/**
 * Set-Field Command - Set field values on existing nodes
 * Spec: F-094 tana-local API Integration
 * Task: T-4.6
 */
import { Command } from 'commander';
import { resolveBackend } from '../api/backend-resolver';
import type { FieldSetMode } from '../types/local-api';
import { exitWithError } from '../utils/errors';

export function createSetFieldCommand(): Command {
  const setField = new Command('set-field');
  setField
    .description('Set or append a field value on an existing node (requires local API)')
    .argument('<nodeId>', 'Node ID to update')
    .argument('<fieldName>', 'Field name or attribute ID')
    .argument('[value]', 'Field value to set (required unless --option-id is used)')
    .option('--field-id <id>', 'Use attribute ID directly (bypass name resolution)')
    .option('--option-id <id>', 'Set as option field with this option ID')
    .option('--append', 'Append to an existing multi-value field instead of replacing it')
    .action(async (nodeId: string, fieldName: string, value: string | undefined, options: { fieldId?: string; optionId?: string; append?: boolean }) => {
      try {
        const backend = await resolveBackend();
        if (!backend.supportsMutations()) {
          console.error('Error: Setting fields requires the local API backend.');
          console.error('Configure with: supertag config --bearer-token <token>');
          process.exit(1);
        }

        const attributeId = options.fieldId || fieldName;
        const mode: FieldSetMode = options.append ? 'append' : 'replace';

        if (options.optionId) {
          // Option field
          const result = await backend.setFieldOption(nodeId, attributeId, options.optionId, mode);
          console.log(`${mode === 'append' ? 'Appended option to' : 'Set option field on'} node ${result.nodeId}`);
          console.log(`  Field: ${result.attributeId}`);
          console.log(`  Option: ${result.optionName}`);
        } else {
          if (value === undefined) {
            console.error('Error: Field value is required unless --option-id is used.');
            process.exit(1);
          }

          // Content field (text, number, date, url, email)
          const result = await backend.setFieldContent(nodeId, attributeId, value, mode);
          console.log(`${mode === 'append' ? 'Appended to field on' : 'Set field on'} node ${result.nodeId}`);
          console.log(`  Field: ${result.attributeId}`);
          console.log(`  Value: ${result.content}`);
        }
      } catch (error) {
        exitWithError(error);
      }
    });

  return setField;
}
