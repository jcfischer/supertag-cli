/**
 * Schema Audit Detector Registry (F-101)
 *
 * Central registry of all schema detectors.
 * Supports filtering by detector name.
 */

import type { SchemaDetector, SchemaFinding, WorkspaceSchema } from '../types/schema-audit';
import {
  orphanTagsDetector,
  lowUsageTagsDetector,
  duplicateFieldsDetector,
  typeMismatchDetector,
  unusedFieldsDetector,
  fillRateDetector,
  missingInheritanceDetector,
} from './schema-audit-detectors';

/** All available detectors in execution order */
export const DETECTOR_REGISTRY: SchemaDetector[] = [
  orphanTagsDetector,
  lowUsageTagsDetector,
  duplicateFieldsDetector,
  typeMismatchDetector,
  unusedFieldsDetector,
  fillRateDetector,
  missingInheritanceDetector,
];

/**
 * Run detectors against a workspace schema.
 *
 * @param schema - Loaded workspace schema
 * @param options - Optional filter for specific detectors
 * @returns Array of findings from all active detectors
 */
export function runDetectors(
  schema: WorkspaceSchema,
  options?: { detectors?: string[] }
): SchemaFinding[] {
  const activeDetectors = options?.detectors
    ? DETECTOR_REGISTRY.filter(d => options.detectors!.includes(d.name))
    : DETECTOR_REGISTRY;

  return activeDetectors.flatMap(d => d.detect(schema));
}
