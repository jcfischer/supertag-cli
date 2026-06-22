/**
 * MCP Tools: tana_set_field, tana_set_field_option
 * Set field values on nodes
 * Spec: F-094, Task: T-5.6
 */
import { resolveBackend } from '../../api/backend-resolver';
import { handleMcpError } from '../error-handler';

export async function handleSetField(args: {
  nodeId: string;
  attributeId: string;
  content: string;
  mode?: 'replace' | 'append';
}) {
  try {
    const backend = await resolveBackend();
    if (!backend.supportsMutations()) {
      return {
        content: [{ type: 'text' as const, text: 'Error: Setting fields requires the local API backend. Configure with: supertag config --bearer-token <token>' }],
        isError: true,
      };
    }

    const mode = args.mode ?? 'replace';
    const result = await backend.setFieldContent(args.nodeId, args.attributeId, args.content, mode);
    return {
      content: [{ type: 'text' as const, text: `${mode === 'append' ? 'Appended to' : 'Set'} field ${result.attributeId} on node ${result.nodeId}: ${result.content}` }],
    };
  } catch (error) {
    return handleMcpError(error);
  }
}

export async function handleSetFieldOption(args: {
  nodeId: string;
  attributeId: string;
  optionId: string;
  mode?: 'replace' | 'append';
}) {
  try {
    const backend = await resolveBackend();
    if (!backend.supportsMutations()) {
      return {
        content: [{ type: 'text' as const, text: 'Error: Setting fields requires the local API backend. Configure with: supertag config --bearer-token <token>' }],
        isError: true,
      };
    }

    const mode = args.mode ?? 'replace';
    const result = await backend.setFieldOption(args.nodeId, args.attributeId, args.optionId, mode);
    return {
      content: [{ type: 'text' as const, text: `${mode === 'append' ? 'Appended option to' : 'Set option field'} ${result.attributeId} on node ${result.nodeId}: ${result.optionName}` }],
    };
  } catch (error) {
    return handleMcpError(error);
  }
}
