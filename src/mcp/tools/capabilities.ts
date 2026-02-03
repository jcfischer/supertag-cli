/**
 * tana_capabilities MCP Tool
 *
 * Returns lightweight capabilities inventory for progressive disclosure.
 * Part of Spec 061: Progressive Disclosure, F-096: Lite Mode.
 */

import type { CapabilitiesInput } from '../schemas.js';
import type { CapabilitiesResponse } from '../tool-registry.js';
import { getCapabilities } from '../tool-registry.js';
import { getToolMode } from '../tool-mode.js';

/**
 * Handler for tana_capabilities MCP tool
 */
export async function capabilities(input: CapabilitiesInput): Promise<CapabilitiesResponse> {
  const mode = getToolMode();
  return getCapabilities({
    category: input.category,
    mode,
  });
}
