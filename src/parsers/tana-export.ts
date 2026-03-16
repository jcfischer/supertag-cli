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

  // Zod defaults (inbound_refs=[], outbound_refs=[], editMode=false) are
  // not applied here — they're unused in the codebase. Consumers access
  // node.children, node.props.name, node.props._ownerId directly.

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
    // Bun.file().json() avoids intermediate string allocation for large files
    const json = await Bun.file(filePath).json();

    // Handle API export wrapper format
    const data = json.storeData ?? json;
    return fastValidate(data);
  }

  /**
   * Build complete graph with supertags, fields, inline refs
   * Single-pass design: iterates docs twice (index build + classification)
   * instead of 5 separate passes.
   */
  buildGraph(dump: TanaDump): TanaGraph {
    const index = new Map<string, NodeDump>();
    const trash = new Map<string, NodeDump>();
    const supertags = new Map<string, SupertagTuple>();
    const fields = new Map<string, FieldTuple>();
    const inlineRefs: InlineReference[] = [];
    const tagColors = new Map<string, string>();
    const tagApplications: TagApplication[] = [];

    // Pass 1: Build index and identify trash
    let trashChildren: Set<string> | null = null;
    for (const node of dump.docs) {
      if (node.id.includes("TRASH")) {
        trash.set(node.id, node);
        if (node.children) {
          trashChildren = new Set(node.children);
        }
        continue;
      }
      index.set(node.id, node);
    }

    // Mark trashed children
    if (trashChildren) {
      for (const nodeId of trashChildren) {
        const node = index.get(nodeId);
        if (node) trash.set(nodeId, node);
      }
    }

    // Inline ref regex (compiled once)
    const inlineRefPattern = /<span data-inlineref-node="([^"]*)"><\/span>/g;

    // Pass 2: Single pass — classify each node (supertag, field, tag application, inline refs)
    for (const node of dump.docs) {
      // Skip trash and system-only nodes
      if (!index.has(node.id)) continue;

      // Extract inline refs from name (independent of children)
      const name = node.props.name;
      if (name && name.includes("data-inlineref-node")) {
        inlineRefPattern.lastIndex = 0;
        const targetIds: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = inlineRefPattern.exec(name)) !== null) {
          if (index.has(m[1])) targetIds.push(m[1]);
        }
        if (targetIds.length > 0) {
          inlineRefs.push({ sourceNodeId: node.id, targetNodeIds: targetIds, type: "inline_ref" });
        }
      }

      // Skip nodes without children or SYS nodes for tuple detection
      const children = node.children;
      if (!children || node.id.includes("SYS")) continue;

      // Fast check: does children contain SYS_A13?
      // Use indexOf instead of includes for slight perf gain on large arrays
      let hasSysA13 = false;
      let hasSysT01 = false;
      let hasSysT02 = false;
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c === "SYS_A13") hasSysA13 = true;
        else if (c === "SYS_T01") hasSysT01 = true;
        else if (c === "SYS_T02") hasSysT02 = true;
      }

      if (!hasSysA13) continue;

      const ownerId = node.props._ownerId;
      if (!ownerId || trash.has(ownerId)) continue;
      const metaNode = index.get(ownerId);
      if (!metaNode) continue;

      if (hasSysT01) {
        // Supertag tuple
        const tagId = metaNode.props._ownerId;
        if (!tagId || trash.has(tagId)) continue;
        const tagNode = index.get(tagId);
        if (!tagNode?.props.name) continue;
        const tagName = tagNode.props.name;

        const superclasses: string[] = [];
        for (const childId of children) {
          if (childId.includes("SYS") || trash.has(childId)) continue;
          const sc = index.get(childId);
          if (sc?.props.name) superclasses.push(sc.props.name);
        }

        supertags.set(tagName, { nodeId: node.id, tagName, tagId, superclasses, color: node.color });
        if (node.color) tagColors.set(tagName, node.color);
      } else if (hasSysT02) {
        // Field tuple
        const fieldId = metaNode.props._ownerId;
        if (!fieldId || trash.has(fieldId)) continue;
        const fieldNode = index.get(fieldId);
        if (!fieldNode?.props.name) continue;
        fields.set(fieldNode.props.name, { nodeId: node.id, fieldName: fieldNode.props.name, fieldId });
      } else if (!trash.has(node.id)) {
        // Tag application (has SYS_A13 but not T01/T02)
        const dataNodeId = metaNode.props._ownerId;
        if (!dataNodeId || trash.has(dataNodeId) || !index.has(dataNodeId)) continue;

        for (const childId of children) {
          if (childId.includes("SYS") || trash.has(childId) || !index.has(childId)) continue;
          const tagNode = index.get(childId);
          const tagName = tagNode?.props.name;
          if (tagName) {
            tagApplications.push({ tupleNodeId: node.id, dataNodeId, tagId: childId, tagName });
          }
        }
      }
    }

    return { nodes: index, trash, supertags, fields, inlineRefs, tagColors, tagApplications };
  }

}
