/**
 * Enrichment Truncator (F-104)
 *
 * Ensures enriched text fits within the embedding model's context window
 * (512 tokens for BGE-M3). Uses a character-based heuristic (4 chars ≈ 1 token)
 * to avoid adding a tiktoken dependency.
 *
 * Truncation priority (preserve highest-priority first):
 * 1. Supertag type name (always preserved)
 * 2. Options/enum fields
 * 3. Date fields
 * 4. Instance/reference fields
 * 5. Node name
 * 6. Plain text fields (truncated last)
 */

/** Default max tokens for BGE-M3 */
const DEFAULT_MAX_TOKENS = 512;

/** Conservative character-to-token ratio (4 chars ≈ 1 token) */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count using character heuristic.
 * Conservative: overestimates slightly to avoid exceeding limits.
 *
 * @param text - Input text
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate enriched text to fit within the token limit.
 *
 * Preserves the [Type: ...] prefix first, then progressively
 * removes field prefixes from lowest priority to highest.
 * As a final measure, truncates the node name itself.
 *
 * @param text - Enriched text to truncate
 * @param maxTokens - Maximum token budget (default: 512)
 * @returns Truncated text that fits within the token limit
 */
export function truncateEnrichedText(
  text: string,
  maxTokens: number = DEFAULT_MAX_TOKENS
): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (text.length <= maxChars) {
    return text;
  }

  // Parse the enriched text into segments:
  // [Type: #tag] [Field: value] [Field: value] Node name
  const segments = parseEnrichedSegments(text);

  if (!segments) {
    // Not in enriched format — just hard truncate
    return text.slice(0, maxChars);
  }

  // Try removing field segments from the end (lowest priority first)
  // Keep type prefix always, remove field prefixes one by one
  let current = segments.typePrefix;
  const fieldsToKeep: string[] = [];

  for (const field of segments.fieldPrefixes) {
    const candidate = buildText(current, [...fieldsToKeep, field], segments.nodeName);
    if (candidate.length <= maxChars) {
      fieldsToKeep.push(field);
    } else {
      break;
    }
  }

  // Try with all kept fields + full node name
  let result = buildText(current, fieldsToKeep, segments.nodeName);
  if (result.length <= maxChars) {
    return result;
  }

  // Node name is too long — truncate it
  const prefixPart = current + (fieldsToKeep.length > 0 ? " " + fieldsToKeep.join(" ") : "");
  const availableChars = maxChars - prefixPart.length - 1; // -1 for space before name

  if (availableChars > 10) {
    return prefixPart + " " + segments.nodeName.slice(0, availableChars);
  }

  // Extreme case: just the type prefix
  if (current.length <= maxChars) {
    return current;
  }

  // Even type prefix too long (shouldn't happen in practice)
  return text.slice(0, maxChars);
}

interface EnrichedSegments {
  typePrefix: string;
  fieldPrefixes: string[];
  nodeName: string;
}

/**
 * Parse enriched text into type prefix, field prefixes, and node name.
 */
function parseEnrichedSegments(text: string): EnrichedSegments | null {
  // Match [Type: ...] prefix
  const typeMatch = text.match(/^(\[Type: [^\]]+\])/);
  if (!typeMatch) {
    return null;
  }

  const typePrefix = typeMatch[1];
  let remaining = text.slice(typePrefix.length).trimStart();

  // Extract field prefixes [Field: value]
  const fieldPrefixes: string[] = [];
  const fieldRegex = /^\[([^\]]+)\]/;

  while (remaining.length > 0) {
    const fieldMatch = remaining.match(fieldRegex);
    if (!fieldMatch) break;
    fieldPrefixes.push(fieldMatch[0]);
    remaining = remaining.slice(fieldMatch[0].length).trimStart();
  }

  return {
    typePrefix,
    fieldPrefixes,
    nodeName: remaining,
  };
}

/**
 * Rebuild enriched text from segments.
 */
function buildText(
  typePrefix: string,
  fieldPrefixes: string[],
  nodeName: string
): string {
  const parts = [typePrefix, ...fieldPrefixes, nodeName];
  return parts.join(" ");
}
