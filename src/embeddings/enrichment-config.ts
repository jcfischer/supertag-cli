/**
 * Enrichment Configuration Loader (F-104)
 *
 * Loads and resolves graph-aware enrichment configuration.
 * Config file: ~/.config/supertag/embed-enrichment.json
 * Falls back to DEFAULT_ENRICHMENT_CONFIG when file is missing or invalid.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TANA_CONFIG_DIR } from "../config/paths";
import {
  DEFAULT_ENRICHMENT_CONFIG,
  type GraphAwareEnrichmentConfig,
  type SupertagEnrichmentConfig,
} from "../types/enrichment";

const ENRICHMENT_CONFIG_FILE = join(TANA_CONFIG_DIR, "embed-enrichment.json");

/**
 * Load enrichment configuration from disk.
 * Returns defaults if file is missing or invalid.
 */
export function loadEnrichmentConfig(): GraphAwareEnrichmentConfig {
  if (!existsSync(ENRICHMENT_CONFIG_FILE)) {
    return DEFAULT_ENRICHMENT_CONFIG;
  }

  try {
    const raw = readFileSync(ENRICHMENT_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    // Validate basic structure
    if (!parsed || typeof parsed !== "object") {
      console.warn("⚠️  Invalid enrichment config: expected object, using defaults");
      return DEFAULT_ENRICHMENT_CONFIG;
    }

    // Merge with defaults to fill missing fields
    return {
      defaults: {
        includeTagName: parsed.defaults?.includeTagName ?? DEFAULT_ENRICHMENT_CONFIG.defaults.includeTagName,
        includeFields: parsed.defaults?.includeFields ?? DEFAULT_ENRICHMENT_CONFIG.defaults.includeFields,
        maxFieldsPerTag: parsed.defaults?.maxFieldsPerTag ?? DEFAULT_ENRICHMENT_CONFIG.defaults.maxFieldsPerTag,
      },
      overrides: parsed.overrides ?? {},
    };
  } catch (error) {
    console.warn(`⚠️  Failed to parse enrichment config: ${error instanceof Error ? error.message : String(error)}, using defaults`);
    return DEFAULT_ENRICHMENT_CONFIG;
  }
}

/**
 * Get effective enrichment config for a specific supertag.
 * Merges defaults with per-tag overrides.
 *
 * @returns null if enrichment is disabled for this tag
 */
export function getConfigForTag(
  config: GraphAwareEnrichmentConfig,
  tagName: string
): SupertagEnrichmentConfig | null {
  const key = tagName.toLowerCase();
  const override = config.overrides[key];

  if (override?.disabled) {
    return null;
  }

  return {
    includeFields: override?.includeFields,
    maxFieldsPerTag: override?.maxFieldsPerTag ?? config.defaults.maxFieldsPerTag,
    disabled: false,
  };
}

// Re-export for convenience
export { ENRICHMENT_CONFIG_FILE };
