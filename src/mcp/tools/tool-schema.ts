/**
 * tana_tool_schema MCP Tool
 *
 * Returns full JSON schema for a specific tool.
 * Part of Spec 061: Progressive Disclosure.
 */

import type { ToolSchemaInput } from '../schemas.js';
import { getToolSchema, listToolNames } from '../tool-registry.js';

interface ToolSchemaResponse {
  tool: string;
  schema: Record<string, unknown>;
}

/**
 * Handler for tana_tool_schema MCP tool
 */
export async function toolSchema(input: ToolSchemaInput): Promise<ToolSchemaResponse> {
  const schema = getToolSchema(input.tool);

  if (!schema) {
    const available = listToolNames().join(', ');
    throw new Error(`Unknown tool: ${input.tool}. Available tools: ${available}`);
  }

  return {
    tool: input.tool,
    schema,
  };
}
