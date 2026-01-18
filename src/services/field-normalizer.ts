/**
 * Field Input Normalizer
 *
 * Normalizes field input to canonical flat format.
 * Handles both nested {"fields": {...}} and flat {...} formats.
 *
 * Spec: F-091 unified-field-format
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Reserved keys that are never treated as field names.
 * These are structural properties used by the create API.
 */
export const RESERVED_KEYS = [
  'name',
  'title',
  'label',
  'heading',
  'subject',
  'summary',
  'supertag',
  'children',
  'target',
  'workspace',
  'dryRun',
  'fields', // The nested container itself
] as const;

export type ReservedKey = (typeof RESERVED_KEYS)[number];

// =============================================================================
// Types
// =============================================================================

/** Input format detected during normalization */
export type InputFormat = 'nested' | 'flat' | 'mixed';

/** Options for normalization */
export interface NormalizeOptions {
  /** Include field validation errors in result */
  validate?: boolean;
  /** Schema to validate against (for error messages) */
  schemaFields?: string[];
}

/** Result of normalizing field input */
export interface NormalizeResult {
  /** Normalized flat field map */
  fields: Record<string, string | string[]>;
  /** Fields that were not recognized (for error messages) */
  unrecognizedFields?: string[];
  /** Original format detected */
  inputFormat: InputFormat;
}

/** Field value type - string or array of strings (for multi-select) */
export type FieldValue = string | string[];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a key is a reserved key (not a field name).
 *
 * @param key - The key to check
 * @returns true if the key is reserved
 */
export function isReservedKey(key: string): key is ReservedKey {
  return RESERVED_KEYS.includes(key as ReservedKey);
}

/**
 * Check if a value is a valid field value (string or array of strings).
 *
 * @param value - The value to check
 * @returns true if the value is a valid field value
 */
function isValidFieldValue(value: unknown): value is FieldValue {
  if (typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string');
  }
  return false;
}

/**
 * Check if the fields property is a valid object (not null, not array, not primitive).
 *
 * @param fields - The fields value to check
 * @returns true if fields is a valid object
 */
function isValidFieldsObject(fields: unknown): fields is Record<string, unknown> {
  return fields !== null && typeof fields === 'object' && !Array.isArray(fields);
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Normalize field input to canonical flat format.
 *
 * Handles three input patterns:
 * 1. **Nested format**: `{ fields: { Status: "Done" } }` → inputFormat: "nested"
 * 2. **Flat format**: `{ Status: "Done" }` → inputFormat: "flat"
 * 3. **Mixed format**: `{ Status: "Done", fields: { Priority: "High" } }` → inputFormat: "mixed"
 *
 * Key behavior:
 * - Reserved keys (name, supertag, children, etc.) are never treated as fields
 * - Nested `fields` property values override flat values for the same key
 * - Empty input returns `{ fields: {}, inputFormat: 'flat' }`
 * - `null` or non-object `fields` property is treated as flat format
 *
 * @example
 * // Nested format
 * normalizeFieldInput({ fields: { Status: "Done" } })
 * // => { fields: { Status: "Done" }, inputFormat: "nested" }
 *
 * @example
 * // Flat format
 * normalizeFieldInput({ Status: "Done" })
 * // => { fields: { Status: "Done" }, inputFormat: "flat" }
 *
 * @example
 * // Mixed format (nested takes precedence)
 * normalizeFieldInput({ Status: "Done", fields: { Status: "Nested" } })
 * // => { fields: { Status: "Nested" }, inputFormat: "mixed" }
 *
 * @param input - The input object containing fields in any format
 * @param _options - Optional configuration (reserved for future validation)
 * @returns Normalized result with flat fields map and format metadata
 */
export function normalizeFieldInput(
  input: Record<string, unknown>,
  _options?: NormalizeOptions
): NormalizeResult {
  // Handle empty or invalid input
  if (!input || typeof input !== 'object') {
    return {
      fields: {},
      inputFormat: 'flat',
    };
  }

  // Extract nested fields (if valid object)
  const nestedFields = isValidFieldsObject(input.fields) ? input.fields : null;
  const hasNestedFields = nestedFields !== null;

  // Extract flat fields (top-level keys that are not reserved)
  const flatFields: Record<string, FieldValue> = {};
  let hasFlatFields = false;

  for (const [key, value] of Object.entries(input)) {
    // Skip reserved keys
    if (isReservedKey(key)) {
      continue;
    }

    // Only include valid field values
    if (isValidFieldValue(value)) {
      flatFields[key] = value;
      hasFlatFields = true;
    }
  }

  // Determine input format
  let inputFormat: InputFormat;
  if (hasNestedFields && hasFlatFields) {
    inputFormat = 'mixed';
  } else if (hasNestedFields) {
    inputFormat = 'nested';
  } else {
    inputFormat = 'flat';
  }

  // Merge fields: start with flat, then overlay nested (nested takes precedence)
  const fields: Record<string, FieldValue> = { ...flatFields };

  if (nestedFields) {
    for (const [key, value] of Object.entries(nestedFields)) {
      if (isValidFieldValue(value)) {
        fields[key] = value;
      }
    }
  }

  return {
    fields,
    inputFormat,
  };
}
