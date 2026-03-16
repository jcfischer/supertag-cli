/**
 * Tana Export Parser
 *
 * Parses Tana JSON exports and builds complete graph structure with:
 * - Supertag detection (SYS_A13 + SYS_T01 tuples)
 * - Field detection (SYS_A13 + SYS_T02 tuples)
 * - Inline reference extraction (<span data-inlineref-node="..."></span>)
 * - Trash filtering
 * - Graph relationships
 *
 * Ported from: jcf-tana-helper/service/service/endpoints/graph_view.py
 */

import type {
  TanaDump,
  NodeDump,
  TanaGraph,
  SupertagTuple,
  FieldTuple,
  InlineReference,
  TagApplication,
} from "../types/tana-dump";
import { TanaDumpSchema } from "../types/tana-dump";

/**
 * Fast structural validation — checks top-level shape without per-node Zod overhead.
 * Falls back to full Zod parse if structure looks unexpected.
 */
function fastValidate(data: any): TanaDump {
  // Quick structural check on top-level fields
  if (
    typeof data !== "object" || data === null ||
    typeof data.formatVersion !== "number" ||
    !Array.isArray(data.docs) ||
    !Array.isArray(data.editors) ||
    typeof data.workspaces !== "object"
  ) {
    // Fall back to full Zod validation for better error messages
    return TanaDumpSchema.parse(data);
  }

  // Apply defaults that Zod would normally set on nodes
  for (const node of data.docs) {
    if (!node.inbound_refs) node.inbound_refs = [];
    if (!node.outbound_refs) node.outbound_refs = [];
    if (node.props && node.props.editMode === undefined) node.props.editMode = false;
  }

  return data as TanaDump;
}

export class TanaExportParser {
  /**
   * Parse Tana JSON export file
   * Validates against schema and returns typed TanaDump
   *
   * Handles two export formats:
   * 1. Direct format: { formatVersion, docs, editors, workspaces, ... }
   * 2. API wrapper format: { storeData: { formatVersion, docs, editors, ... } }
   */
  async parseFile(filePath: string): Promise<TanaDump> {
    const file = Bun.file(filePath);
    const content = await file.text();
    const json = JSON.parse(content);

    // Handle API export wrapper format
    const data = json.storeData ?? json;
    return fastValidate(data);
  }

  /**
   * Build complete graph with supertags, fields, inline refs
   * Ported from graph_view.py lines 39-272
   */
  buildGraph(dump: TanaDump): TanaGraph {
    const index = new Map<string, NodeDump>();
    const trash = new Map<string, NodeDump>();
    const supertags = new Map<string, SupertagTuple>();
    const fields = new Map<string, FieldTuple>();
    const inlineRefs: InlineReference[] = [];
    const tagColors = new Map<string, string>();
    const tagApplications: TagApplication[] = [];

    // Step 1: Build index and identify trash (lines 78-98)
    let trashNode: NodeDump | null = null;
    for (const node of dump.docs) {
      if (node.id.includes("TRASH")) {
        trashNode = node;
        trash.set(node.id, node);
        continue;
      }
      index.set(node.id, node);
    }

    // Step 2: Remove trashed nodes from index (lines 90-98)
    if (trashNode?.children) {
      for (const nodeId of trashNode.children) {
        const node = index.get(nodeId);
        if (node) {
          trash.set(nodeId, node);
          // Keep in index for now, but mark as trashed
        }
      }
    }

    // Step 3: Detect supertags (lines 103-140)
    this.detectSupertags(dump.docs, index, trash, supertags, tagColors);

    // Step 4: Detect fields (lines 143-146)
    this.detectFields(dump.docs, index, trash, fields);

    // Step 5: Extract inline references (implied from patching logic)
    this.extractInlineRefs(dump.docs, index, inlineRefs);

    // Step 6: Detect tag applications (which nodes have which tags)
    // This is the key missing piece - linking nodes to their applied supertags
    this.detectTagApplications(dump.docs, index, trash, tagApplications);

    return { nodes: index, trash, supertags, fields, inlineRefs, tagColors, tagApplications };
  }

  /**
   * Detect supertags from tuple structure
   * Ported from graph_view.py lines 103-140
   *
   * Supertag tuple pattern:
   * - children contains SYS_A13 (association marker)
   * - children contains SYS_T01 (supertag type marker)
   * - props._ownerId points to meta node
   * - meta node's _ownerId points to tag node
   * - Additional children (beyond SYS_A13, SYS_T01) are superclasses
   */
  private detectSupertags(
    docs: NodeDump[],
    index: Map<string, NodeDump>,
    trash: Map<string, NodeDump>,
    supertags: Map<string, SupertagTuple>,
    tagColors: Map<string, string>
  ): void {
    for (const node of docs) {
      // Skip if not in index (trashed or TRASH node itself)
      if (!index.has(node.id)) continue;

      // Skip system nodes without children
      if (!node.children || node.id.includes("SYS")) continue;

      // Check for supertag tuple marker (SYS_A13 + SYS_T01)
      if (
        !node.children.includes("SYS_A13") ||
        !node.children.includes("SYS_T01")
      ) {
        continue;
      }

      // Get owner ID (meta node)
      const ownerId = node.props._ownerId;
      if (!ownerId || trash.has(ownerId)) continue;

      const metaNode = index.get(ownerId);
      if (!metaNode) continue;

      // Get tag ID from meta node
      const tagId = metaNode.props._ownerId;
      if (!tagId || trash.has(tagId)) continue;

      const tagNode = index.get(tagId);
      if (!tagNode?.props.name) continue;

      const tagName = tagNode.props.name;

      // Extract superclasses (children beyond SYS markers)
      const superclasses: string[] = [];
      for (const childId of node.children) {
        if (childId.includes("SYS") || trash.has(childId)) continue;

        const superclass = index.get(childId);
        if (superclass?.props.name) {
          superclasses.push(superclass.props.name);
        }
      }

      // Store supertag tuple
      supertags.set(tagName, {
        nodeId: node.id,
        tagName,
        tagId,
        superclasses,
        color: node.color,
      });

      // Store tag color if present
      if (node.color) {
        tagColors.set(tagName, node.color);
      }
    }
  }

  /**
   * Detect fields from tuple structure
   * Similar to supertags but with SYS_T02 marker
   * Ported from graph_view.py lines 143-146
   */
  private detectFields(
    docs: NodeDump[],
    index: Map<string, NodeDump>,
    trash: Map<string, NodeDump>,
    fields: Map<string, FieldTuple>
  ): void {
    for (const node of docs) {
      if (!index.has(node.id)) continue;
      if (!node.children) continue;

      // Check for field tuple marker (SYS_A13 + SYS_T02)
      if (
        !node.children.includes("SYS_A13") ||
        !node.children.includes("SYS_T02")
      ) {
        continue;
      }

      const ownerId = node.props._ownerId;
      if (!ownerId || trash.has(ownerId)) continue;

      const metaNode = index.get(ownerId);
      if (!metaNode) continue;

      const fieldId = metaNode.props._ownerId;
      if (!fieldId || trash.has(fieldId)) continue;

      const fieldNode = index.get(fieldId);
      if (!fieldNode?.props.name) continue;

      const fieldName = fieldNode.props.name;

      fields.set(fieldName, {
        nodeId: node.id,
        fieldName,
        fieldId,
      });
    }
  }

  /**
   * Extract inline references from node names
   * Pattern: <span data-inlineref-node="NODE_ID"></span>
   * Ported from graph_view.py lines 63-76 (patch_node_name logic)
   */
  private extractInlineRefs(
    docs: NodeDump[],
    index: Map<string, NodeDump>,
    inlineRefs: InlineReference[]
  ): void {
    const inlineRefPattern = /<span data-inlineref-node="([^"]*)"><\/span>/g;

    for (const node of docs) {
      if (!node.props.name) continue;

      const matches = [...node.props.name.matchAll(inlineRefPattern)];
      if (matches.length === 0) continue;

      // Extract all target IDs from matches
      const targetIds = matches
        .map((m) => m[1])
        .filter((id) => index.has(id)); // Only include valid node IDs

      if (targetIds.length > 0) {
        inlineRefs.push({
          sourceNodeId: node.id,
          targetNodeIds: targetIds,
          type: "inline_ref",
        });
      }
    }
  }

  /**
   * Detect tag applications (which nodes have which supertags applied)
   * Ported from graph_view.py build_master_pairs() lines 153-183
   *
   * Tag application pattern:
   * - Node children contains SYS_A13 (tag marker)
   * - Node children does NOT contain SYS_T01 (supertag definition)
   * - Node children does NOT contain SYS_T02 (field definition)
   * - Navigate: node.props._ownerId -> metaNode -> metaNode.props._ownerId -> dataNode
   * - The tag IDs are the non-SYS children
   */
  private detectTagApplications(
    docs: NodeDump[],
    index: Map<string, NodeDump>,
    trash: Map<string, NodeDump>,
    tagApplications: TagApplication[]
  ): void {
    // System constants (from tana-helper)
    const SYS_A13 = "SYS_A13"; // Tag marker
    const SYS_T01 = "SYS_T01"; // Supertag definition marker
    const SYS_T02 = "SYS_T02"; // Field definition marker

    for (const node of docs) {
      // Skip if not in index (trashed or system)
      if (!index.has(node.id)) continue;
      if (trash.has(node.id)) continue;

      // Skip system nodes and nodes without children
      if (!node.children || node.id.includes("SYS")) continue;

      // Check for tag application: has SYS_A13 but NOT SYS_T01 and NOT SYS_T02
      if (!node.children.includes(SYS_A13)) continue;
      if (node.children.includes(SYS_T01)) continue; // This is a tag definition
      if (node.children.includes(SYS_T02)) continue; // This is a field definition

      // This is a tag application tuple!
      // Navigate to find the data node
      const ownerId = node.props._ownerId;
      if (!ownerId || trash.has(ownerId)) continue;
      if (!index.has(ownerId)) continue;

      const metaNode = index.get(ownerId)!;
      const dataNodeId = metaNode.props._ownerId;
      if (!dataNodeId || trash.has(dataNodeId)) continue;
      if (!index.has(dataNodeId)) continue;

      // Extract tag IDs (non-SYS children)
      for (const childId of node.children) {
        if (childId.includes("SYS")) continue;
        if (trash.has(childId)) continue;
        if (!index.has(childId)) continue;

        // This is a tag ID - resolve the tag name
        const tagNode = index.get(childId);
        const tagName = tagNode?.props.name;

        if (tagName) {
          tagApplications.push({
            tupleNodeId: node.id,
            dataNodeId,
            tagId: childId,
            tagName,
          });
        }
      }
    }
  }
}
