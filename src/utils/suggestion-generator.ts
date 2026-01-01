/**
 * Suggestion Generator
 * Spec: 073-error-context
 * Task: T-2.2
 *
 * Generates smart suggestions for errors using fuzzy matching
 * and error-type-specific hint generation.
 */

import { distance } from "fastest-levenshtein";
import { getDefaultSuggestion } from "./error-registry";
import type { ErrorCode } from "../types/errors";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for findSimilarValues
 */
export interface FindSimilarOptions {
  /** Maximum number of results to return (default: 3) */
  maxResults?: number;
  /** Minimum similarity threshold 0-1 (default: 0.5) */
  threshold?: number;
}

/**
 * Details that can be used for suggestion generation
 */
export interface SuggestionDetails {
  // For TAG_NOT_FOUND
  tag?: string;
  availableTags?: string[];

  // For WORKSPACE_NOT_FOUND
  workspace?: string;
  availableWorkspaces?: string[];

  // For NODE_NOT_FOUND
  query?: string;
  similarNodes?: string[];

  // For RATE_LIMITED
  retryAfter?: number;

  // For INVALID_FORMAT / validation errors
  field?: string;
  expected?: string;
  value?: unknown;

  // Generic
  [key: string]: unknown;
}

// =============================================================================
// Fuzzy Matching
// =============================================================================

/**
 * Calculate similarity ratio between two strings (0-1)
 * Uses Levenshtein distance normalized by the longer string length
 */
function calculateSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;

  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();

  if (lowerA === lowerB) return 1;

  const dist = distance(lowerA, lowerB);
  const maxLen = Math.max(lowerA.length, lowerB.length);

  return 1 - dist / maxLen;
}

/**
 * Find similar values from a list of candidates using Levenshtein distance
 *
 * @param input - The input string to match
 * @param candidates - List of candidate values to search
 * @param options - Optional configuration
 * @returns Array of similar values sorted by similarity (best first)
 */
export function findSimilarValues(
  input: string,
  candidates: string[],
  options?: FindSimilarOptions
): string[] {
  const maxResults = options?.maxResults ?? 3;
  const threshold = options?.threshold ?? 0.5;

  if (!input || candidates.length === 0) {
    return [];
  }

  // Calculate similarity for each candidate
  const scored = candidates
    .map((candidate) => ({
      value: candidate,
      similarity: calculateSimilarity(input, candidate),
    }))
    .filter((item) => item.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);

  return scored.map((item) => item.value);
}

/**
 * Format similar values into a suggestion string
 *
 * @param similarValues - Array of similar values
 * @param maxDisplay - Maximum values to display (default: 3)
 * @returns Formatted suggestion or undefined if no values
 */
export function formatSimilarValuesSuggestion(
  similarValues: string[],
  maxDisplay = 3
): string | undefined {
  if (similarValues.length === 0) {
    return undefined;
  }

  const displayed = similarValues.slice(0, maxDisplay);
  return `Did you mean: ${displayed.join(", ")}?`;
}

// =============================================================================
// Suggestion Generation
// =============================================================================

/**
 * Generate a suggestion based on error code and context
 *
 * @param code - Error code
 * @param details - Optional details for context-specific suggestions
 * @returns Suggestion string or undefined
 */
export function generateSuggestion(
  code: ErrorCode,
  details?: SuggestionDetails
): string | undefined {
  // Start with any default suggestion from registry
  const defaultSuggestion = getDefaultSuggestion(code);
  let contextSuggestion: string | undefined;

  // Generate context-specific suggestions based on error type
  switch (code) {
    case "TAG_NOT_FOUND":
      if (details?.tag && details?.availableTags) {
        const similar = findSimilarValues(details.tag, details.availableTags);
        contextSuggestion = formatSimilarValuesSuggestion(similar);
      }
      break;

    case "WORKSPACE_NOT_FOUND":
      if (details?.workspace && details?.availableWorkspaces) {
        const similar = findSimilarValues(details.workspace, details.availableWorkspaces);
        contextSuggestion = formatSimilarValuesSuggestion(similar);
      }
      break;

    case "NODE_NOT_FOUND":
      if (details?.query && details?.similarNodes) {
        contextSuggestion = formatSimilarValuesSuggestion(details.similarNodes);
      } else if (details?.similarNodes && details.similarNodes.length > 0) {
        contextSuggestion = formatSimilarValuesSuggestion(details.similarNodes);
      }
      break;

    case "RATE_LIMITED":
      if (details?.retryAfter !== undefined) {
        contextSuggestion = `Wait ${details.retryAfter} seconds before retrying.`;
      }
      break;

    case "INVALID_FORMAT":
      if (details?.field && details?.expected) {
        // Extract field name from path like "fields.Due"
        const fieldName = details.field.includes(".")
          ? details.field.split(".").pop()
          : details.field;
        contextSuggestion = `Field "${fieldName}" should use format: ${details.expected}`;
      }
      break;

    default:
      // No context-specific suggestion
      break;
  }

  // Combine suggestions: context-specific takes precedence, but include default if different
  if (contextSuggestion && defaultSuggestion) {
    // If they're different, combine them
    if (!contextSuggestion.includes(defaultSuggestion)) {
      return contextSuggestion;
    }
    return contextSuggestion;
  }

  return contextSuggestion ?? defaultSuggestion;
}
