/**
 * Select Projection Utilities
 * Spec: 059-universal-select-parameter
 * Task: T-1.1
 *
 * Types and functions for field selection/projection in query results.
 * Applied at the output layer to filter response fields.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A parsed field path for selection
 */
export interface SelectPath {
  /** Original path string (e.g., "fields.Status") */
  raw: string;
  /** Split segments (e.g., ["fields", "Status"]) */
  segments: string[];
}

/**
 * Projection configuration for filtering result fields
 */
export interface SelectProjection {
  /** Parsed paths to include */
  paths: SelectPath[];
  /** If true, return all fields (no select specified) */
  includeAll: boolean;
}

// =============================================================================
// Creation Functions
// =============================================================================

/**
 * Create a SelectPath from a field path string
 *
 * @param path - Field path (e.g., "id", "fields.Status")
 * @returns Parsed SelectPath with raw and segments
 *
 * @example
 * createSelectPath("fields.Status")
 * // => { raw: "fields.Status", segments: ["fields", "Status"] }
 */
export function createSelectPath(path: string): SelectPath {
  const trimmed = path.trim();
  const segments = trimmed.split(".").map((s) => s.trim());
  return {
    raw: trimmed,
    segments,
  };
}

/**
 * Create a SelectProjection from various input formats
 *
 * @param select - Comma-separated string, string array, or undefined
 * @returns SelectProjection with parsed paths
 *
 * @example
 * createSelectProjection("id,name,fields.Status")
 * // => { paths: [...], includeAll: false }
 *
 * @example
 * createSelectProjection(undefined)
 * // => { paths: [], includeAll: true }
 */
export function createSelectProjection(
  select: string | string[] | undefined
): SelectProjection {
  // Handle undefined/empty - return all fields
  if (select === undefined || select === "") {
    return { paths: [], includeAll: true };
  }

  // Handle empty array
  if (Array.isArray(select) && select.length === 0) {
    return { paths: [], includeAll: true };
  }

  // Parse string array
  if (Array.isArray(select)) {
    const paths = select
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(createSelectPath);

    return {
      paths,
      includeAll: paths.length === 0,
    };
  }

  // Parse comma-separated string
  const paths = select
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(createSelectPath);

  return {
    paths,
    includeAll: paths.length === 0,
  };
}

/**
 * Parse a comma-separated select string into paths
 * Alias for createSelectProjection - matches spec naming convention
 *
 * @param select - Comma-separated string, string array, or undefined
 * @returns SelectProjection with parsed paths
 */
export const parseSelectPaths = createSelectProjection;

// =============================================================================
// Projection Functions
// =============================================================================

/**
 * Get a value from a nested object using path segments
 *
 * @param obj - Source object to extract from
 * @param segments - Path segments (e.g., ["fields", "Status"])
 * @returns The value at the path, or null if not found
 */
function getNestedValue(
  obj: Record<string, unknown>,
  segments: string[]
): unknown {
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return null;
    }
    if (typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current === undefined ? null : current;
}

/**
 * Set a value in a nested object structure, creating intermediate objects as needed
 *
 * @param result - Target object to set value in
 * @param segments - Path segments (e.g., ["fields", "Status"])
 * @param value - Value to set
 */
function setNestedValue(
  result: Record<string, unknown>,
  segments: string[],
  value: unknown
): void {
  let current = result;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (!(segment in current)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const lastSegment = segments[segments.length - 1];
  current[lastSegment] = value;
}

/**
 * Apply projection to a single object
 *
 * @param obj - Object to project (any object type)
 * @param projection - Projection configuration
 * @returns New object with only selected fields
 *
 * @example
 * applyProjection({ id: "1", name: "Test", extra: true }, projection)
 * // => { id: "1", name: "Test" }
 */
export function applyProjection<T>(
  obj: T,
  projection: SelectProjection
): Partial<Record<string, unknown>> {
  // If includeAll, return original object
  if (projection.includeAll) {
    return obj as unknown as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  const source = obj as unknown as Record<string, unknown>;

  for (const path of projection.paths) {
    const value = getNestedValue(source, path.segments);
    setNestedValue(result, path.segments, value);
  }

  return result;
}

/**
 * Apply projection to an array of objects
 *
 * @param arr - Array of objects to project (any object type)
 * @param projection - Projection configuration
 * @returns New array with projected objects
 *
 * @example
 * applyProjectionToArray([{ id: "1", name: "A" }, { id: "2", name: "B" }], projection)
 * // => [{ id: "1" }, { id: "2" }]  // if projection selects only "id"
 */
export function applyProjectionToArray<T>(
  arr: T[],
  projection: SelectProjection
): Partial<Record<string, unknown>>[] {
  // If includeAll, return original array
  if (projection.includeAll) {
    return arr as unknown as Record<string, unknown>[];
  }

  return arr.map((obj) => applyProjection(obj, projection));
}
