/**
 * Contextualize Text for Embeddings
 *
 * Builds contextualized text by combining a node's name with its meaningful
 * ancestor context. This improves embedding quality for short or ambiguous text.
 *
 * Example transformations:
 * - "Review the proposal" → "Project: Website Redesign | Review the proposal"
 * - "Monika Stucki" → "Contact at Switch | Monika Stucki"
 * - "Good point about testing" → "Meeting: Q4 Planning | Good point about testing"
 */

import { Database } from "bun:sqlite";
import { findMeaningfulAncestor, type AncestorResult } from "./ancestor-resolution";

/**
 * Result of contextualizing a node's text
 */
export interface ContextualizedNode {
  /** Original node ID */
  nodeId: string;
  /** Original node name */
  nodeName: string;
  /** Ancestor node ID (null if node itself has tags or no ancestor found) */
  ancestorId: string | null;
  /** Ancestor node name (null if no ancestor) */
  ancestorName: string | null;
  /** Ancestor's supertags (empty if no ancestor) */
  ancestorTags: string[];
  /** The contextualized text to embed */
  contextText: string;
}

/**
 * Build contextualized text for a single node.
 *
 * Format: "{Tag}: {AncestorName} | {NodeName}"
 * If no ancestor: just "{NodeName}"
 * If node itself has tag: "{Tag}: {NodeName}"
 *
 * @param db - Database connection (nodes table)
 * @param nodeId - Node ID to contextualize
 * @param nodeName - Node name (provided to avoid extra lookup)
 * @returns ContextualizedNode with all context info
 */
export function buildContextualizedNode(
  db: Database,
  nodeId: string,
  nodeName: string
): ContextualizedNode {
  // Find meaningful ancestor
  const ancestorResult = findMeaningfulAncestor(db, nodeId);

  if (!ancestorResult) {
    // No ancestor with supertag - use node name as-is
    return {
      nodeId,
      nodeName,
      ancestorId: null,
      ancestorName: null,
      ancestorTags: [],
      contextText: nodeName,
    };
  }

  // Check if the matched node IS the ancestor (depth 0 means node itself has tag)
  if (ancestorResult.depth === 0) {
    // Node itself has a tag - format as "Tag: NodeName"
    const primaryTag = ancestorResult.ancestor.tags[0];
    return {
      nodeId,
      nodeName,
      ancestorId: null, // No separate ancestor - node is its own context
      ancestorName: null,
      ancestorTags: ancestorResult.ancestor.tags,
      contextText: `${formatTagName(primaryTag)}: ${nodeName}`,
    };
  }

  // Node has a meaningful ancestor - format as "Tag: AncestorName | NodeName"
  const primaryTag = ancestorResult.ancestor.tags[0];
  const ancestorName = ancestorResult.ancestor.name;

  return {
    nodeId,
    nodeName,
    ancestorId: ancestorResult.ancestor.id,
    ancestorName,
    ancestorTags: ancestorResult.ancestor.tags,
    contextText: `${formatTagName(primaryTag)}: ${ancestorName} | ${nodeName}`,
  };
}

/**
 * Batch contextualize nodes for efficient embedding generation.
 *
 * @param db - Database connection
 * @param nodes - Array of nodes with id and name
 * @returns Array of contextualized nodes
 */
export function batchContextualizeNodes(
  db: Database,
  nodes: Array<{ id: string; name: string }>
): ContextualizedNode[] {
  return nodes.map((node) => buildContextualizedNode(db, node.id, node.name));
}

/**
 * Format a tag name for display in context.
 * Capitalizes first letter, removes common prefixes.
 *
 * @param tag - Raw tag name
 * @returns Formatted tag name
 */
function formatTagName(tag: string): string {
  // Remove common prefixes like # if present
  const cleaned = tag.replace(/^#/, "");
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Options for contextualizing nodes with fields
 */
export interface ContextualizeWithFieldsOptions {
  /** Include field values in context text */
  includeFields?: boolean;
}

/**
 * Contextualize nodes with optional field value enrichment
 *
 * This function combines ancestor context with field values to create
 * rich embedding text. When includeFields is true, field values are
 * appended in the format: [FieldName]: value
 *
 * @param db - Database connection
 * @param nodes - Array of nodes with id and name
 * @param options - Options including whether to include fields
 * @returns Array of contextualized nodes with field values
 */
export function contextualizeNodesWithFields(
  db: Database,
  nodes: Array<{ id: string; name: string }>,
  options: ContextualizeWithFieldsOptions = {}
): ContextualizedNode[] {
  const { includeFields = false } = options;

  // First, get basic contextualized nodes
  const contextualizedNodes = batchContextualizeNodes(db, nodes);

  // If not including fields, return as-is
  if (!includeFields) {
    return contextualizedNodes;
  }

  // Import and use context-builder for field enrichment
  const { batchEnrichWithFields } = require("./context-builder");

  // Prepare nodes for field enrichment
  const nodesForEnrichment = contextualizedNodes.map((node) => ({
    nodeId: node.nodeId,
    contextText: node.contextText,
  }));

  // Enrich with field values
  const enrichedNodes = batchEnrichWithFields(db, nodesForEnrichment);

  // Merge back into ContextualizedNode structure
  return contextualizedNodes.map((node, index) => ({
    ...node,
    contextText: enrichedNodes[index].contextText,
  }));
}
