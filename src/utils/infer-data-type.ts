/**
 * Data type options for Tana fields
 *
 * Spec 020: Schema Consolidation - T-2.2
 */
export type DataType = 'text' | 'date' | 'reference' | 'url' | 'email' | 'number' | 'checkbox' | 'options';

/**
 * Infer data type from field name using heuristics
 *
 * Extracted from SchemaRegistry for reuse (Spec 020: Schema Consolidation - T-2.2)
 *
 * @param fieldName - The field name to analyze
 * @returns Inferred data type based on name patterns
 */
export function inferDataType(fieldName: string): DataType {
  const name = fieldName.toLowerCase();

  // Date type - names containing temporal keywords
  // Common patterns: date, time, scheduled, deadline, when, expires, expiry, expiration
  if (
    name.includes('date') ||
    name.includes('time') ||
    name.includes('scheduled') ||
    name.includes('deadline') ||
    name.includes('expir') || // catches expires, expiry, expiration
    name === 'when'
  ) {
    return 'date';
  }

  // URL type - names containing 'url' or 'link'
  if (name.includes('url') || name.includes('link')) {
    return 'url';
  }

  // Number type - names containing 'count', 'number', or 'amount'
  // Exception: 'phone number' should be text
  if (name.includes('phone')) {
    return 'text';
  }
  if (name.includes('count') || name.includes('number') || name.includes('amount')) {
    return 'number';
  }

  // Reference type - names containing 'status', 'type', or 'category'
  if (name.includes('status') || name.includes('type') || name.includes('category')) {
    return 'reference';
  }

  // Checkbox type - boolean-like names
  // Starting with 'is' or 'has' (handles camelCase like isActive, hasChildren)
  if (/^(is|has)($|[A-Z\s-_])/.test(fieldName) || /^(is|has)($|[a-z\s-_])/.test(name)) {
    return 'checkbox';
  }
  // Contains 'enabled' or 'completed'
  if (name.includes('enabled') || name.includes('completed')) {
    return 'checkbox';
  }

  // Default to text
  return 'text';
}
