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
   * Build complete graph with supertags, fields, inline refs.
   * Single iteration over docs — builds index and collects deferred tuple
   * candidates, then resolves them with one pass over the small candidate set.
   */
  buildGraph(dump: TanaDump): TanaGraph {
    const docs = dump.docs;
    const index = new Map<string, NodeDump>();
    const trash = new Map<string, NodeDump>();
    const supertags = new Map<string, SupertagTuple>();
    const fields = new Map<string, FieldTuple>();
    const inlineRefs: InlineReference[] = [];
    const tagColors = new Map<string, string>();
    const tagApplications: TagApplication[] = [];

    // Deferred candidates: nodes with SYS_A13 that need index lookups
    // Tuple: [node, hasSysT01, hasSysT02]
    const candidates: [NodeDump, boolean, boolean][] = [];

    // Inline ref regex (compiled once)
    const inlineRefPattern = /<span data-inlineref-node="([^"]*)"><\/span>/g;

    // Deferred inline refs: [sourceNodeId, rawMatches[]]
    const deferredInlineRefs: [string, string[]][] = [];

    // Trash children for second-pass filtering
    let trashChildIds: string[] | undefined;

    // === SINGLE PASS: build index + collect candidates ===
    for (let i = 0; i < docs.length; i++) {
      const node = docs[i];
      const id = node.id;

      // Trash detection
      if (id.includes("TRASH")) {
        trash.set(id, node);
        if (node.children) trashChildIds = node.children;
        continue;
      }

      // Build index
      index.set(id, node);

      // Collect inline ref candidates (fast string check)
      const name = node.props.name;
      if (name && name.includes("data-inlineref-node")) {
        inlineRefPattern.lastIndex = 0;
        const targets: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = inlineRefPattern.exec(name)) !== null) {
          targets.push(m[1]);
        }
        if (targets.length > 0) deferredInlineRefs.push([id, targets]);
      }

      // Collect tuple candidates (nodes with SYS_A13 in children)
      const children = node.children;
      if (!children || id.includes("SYS")) continue;

      let hasSysA13 = false;
      let hasSysT01 = false;
      let hasSysT02 = false;
      for (let j = 0; j < children.length; j++) {
        const c = children[j];
        if (c === "SYS_A13") hasSysA13 = true;
        else if (c === "SYS_T01") hasSysT01 = true;
        else if (c === "SYS_T02") hasSysT02 = true;
      }

      if (hasSysA13) {
        candidates.push([node, hasSysT01, hasSysT02]);
      }
    }

    // Mark trashed children
    if (trashChildIds) {
      for (const nodeId of trashChildIds) {
        const node = index.get(nodeId);
        if (node) trash.set(nodeId, node);
      }
    }

    // === RESOLVE: inline refs (filter to valid targets) ===
    for (const [sourceId, targets] of deferredInlineRefs) {
      const valid = targets.filter(id => index.has(id));
      if (valid.length > 0) {
        inlineRefs.push({ sourceNodeId: sourceId, targetNodeIds: valid, type: "inline_ref" });
      }
    }

    // === RESOLVE: tuple candidates (only ~1% of nodes) ===
    for (const [node, hasSysT01, hasSysT02] of candidates) {
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
        for (const childId of node.children!) {
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

        for (const childId of node.children!) {
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
