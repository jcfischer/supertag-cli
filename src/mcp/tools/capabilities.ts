/**
 * tana_capabilities MCP Tool
 *
 * Returns lightweight capabilities inventory for progressive disclosure.
 * Part of Spec 061: Progressive Disclosure.
 */

import type { CapabilitiesInput } from '../schemas.js';
import type { CapabilitiesResponse } from '../tool-registry.js';
import { getCapabilities } from '../tool-registry.js';

/**
 * Handler for tana_capabilities MCP tool
 */
export async function capabilities(input: CapabilitiesInput): Promise<CapabilitiesResponse> {
  return getCapabilities(input.category ? { category: input.category } : undefined);
}
