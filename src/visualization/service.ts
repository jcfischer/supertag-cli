/**
 * Visualization Service
 *
 * Gathers supertag inheritance data from the database for visualization.
 * Provides filtering by root tag, depth, and usage count.
 */

import { Database } from "bun:sqlite";
import type {
  VisualizationData,
  VisualizationNode,
  VisualizationLink,
  VisualizationMetadata,
  VisualizationOptions,
  VisualizationField,
} from "./types";
import { SupertagMetadataService } from "../services/supertag-metadata-service";

interface TagRow {
  tag_id: string;
  tag_name: string;
  color: string | null;
  field_count: number;
  usage_count: number;
  parent_count: number;
  child_count: number;
}

interface LinkRow {
  child_tag_id: string;
  parent_tag_id: string;
}

export class VisualizationService {
  private db: Database;
  private workspace: string;

  constructor(db: Database, workspace: string = "test") {
    this.db = db;
    this.workspace = workspace;
  }

  /**
   * Get full visualization data with optional filtering.
   */
  getData(options: VisualizationOptions = {}): VisualizationData {
    const { includeOrphans = false, minUsage } = options;

    // Get all tags with metadata
    const tagRows = this.db.query(`
      SELECT
        sm.tag_id,
        sm.tag_name,
        sm.color,
        (SELECT COUNT(*) FROM supertag_fields sf WHERE sf.tag_id = sm.tag_id) as field_count,
        (SELECT COUNT(*) FROM tag_applications ta WHERE ta.tag_id = sm.tag_id) as usage_count,
        (SELECT COUNT(*) FROM supertag_parents sp WHERE sp.child_tag_id = sm.tag_id) as parent_count,
        (SELECT COUNT(*) FROM supertag_parents sp WHERE sp.parent_tag_id = sm.tag_id) as child_count
      FROM supertag_metadata sm
    `).all() as TagRow[];

    // Get all links
    const linkRows = this.db.query(`
      SELECT child_tag_id, parent_tag_id
      FROM supertag_parents
    `).all() as LinkRow[];

    // Build node map for filtering
    const nodeMap = new Map<string, VisualizationNode>();
    const linkedTagIds = new Set<string>();

    // Collect all tag IDs that are part of inheritance relationships
    for (const link of linkRows) {
      linkedTagIds.add(link.child_tag_id);
      linkedTagIds.add(link.parent_tag_id);
    }

    // Process tags
    for (const row of tagRows) {
      const isOrphan = row.parent_count === 0;

      // Skip orphans unless explicitly included
      if (isOrphan && !includeOrphans && !linkedTagIds.has(row.tag_id)) {
        continue;
      }

      // Apply minUsage filter
      if (minUsage !== undefined && row.usage_count < minUsage) {
        // Still include if it's part of inheritance structure
        if (!linkedTagIds.has(row.tag_id)) {
          continue;
        }
      }

      const node: VisualizationNode = {
        id: row.tag_id,
        name: row.tag_name,
        fieldCount: row.field_count,
        usageCount: row.usage_count,
        isOrphan: row.parent_count === 0,
        isLeaf: row.child_count === 0,
      };

      if (row.color) {
        node.color = row.color;
      }

      nodeMap.set(row.tag_id, node);
    }

    // Filter links to only include those where both nodes exist
    const links: VisualizationLink[] = linkRows
      .filter(row => nodeMap.has(row.child_tag_id) && nodeMap.has(row.parent_tag_id))
      .map(row => ({
        source: row.child_tag_id,
        target: row.parent_tag_id,
      }));

    const nodes = Array.from(nodeMap.values());

    const metadata: VisualizationMetadata = {
      totalTags: nodes.length,
      totalLinks: links.length,
      maxDepth: this.getMaxDepth(),
      generatedAt: new Date().toISOString(),
      workspace: this.workspace,
    };

    return { nodes, links, metadata };
  }

  /**
   * Get subtree starting from a specific tag.
   * Returns null if root tag not found.
   */
  getSubtree(rootTagName: string, maxDepth?: number): VisualizationData | null {
    // Find root tag ID
    const rootResult = this.db.query(`
      SELECT tag_id FROM supertag_metadata WHERE tag_name = ?
    `).get(rootTagName) as { tag_id: string } | null;

    if (!rootResult) {
      return null;
    }

    const rootId = rootResult.tag_id;

    // Get all descendants using recursive CTE
    const depthLimit = maxDepth ?? 10;
    const descendantRows = this.db.query(`
      WITH RECURSIVE descendants(tag_id, depth) AS (
        -- Base case: root tag
        SELECT ?, 0

        UNION ALL

        -- Recursive case: children of current nodes
        SELECT sp.child_tag_id, d.depth + 1
        FROM supertag_parents sp
        INNER JOIN descendants d ON sp.parent_tag_id = d.tag_id
        WHERE d.depth < ?
      )
      SELECT DISTINCT tag_id, MIN(depth) as depth
      FROM descendants
      GROUP BY tag_id
    `).all(rootId, depthLimit) as Array<{ tag_id: string; depth: number }>;

    const includedIds = new Set(descendantRows.map(r => r.tag_id));

    // Get full data and filter to included IDs
    const fullData = this.getData({ includeOrphans: true });

    const nodes = fullData.nodes.filter(n => includedIds.has(n.id));
    const links = fullData.links.filter(l => includedIds.has(l.source) && includedIds.has(l.target));

    // Calculate local max depth
    const localMaxDepth = descendantRows.length > 0
      ? Math.max(...descendantRows.map(r => r.depth))
      : 0;

    const metadata: VisualizationMetadata = {
      totalTags: nodes.length,
      totalLinks: links.length,
      maxDepth: localMaxDepth,
      rootTag: rootTagName,
      generatedAt: new Date().toISOString(),
      workspace: this.workspace,
    };

    return { nodes, links, metadata };
  }

  /**
   * Calculate max depth of inheritance in the entire graph.
   */
  getMaxDepth(): number {
    // Find all root nodes (no parents) and calculate max depth from each
    const result = this.db.query(`
      WITH RECURSIVE depth_calc(tag_id, depth) AS (
        -- Base case: root nodes (no parents)
        SELECT sm.tag_id, 0
        FROM supertag_metadata sm
        WHERE NOT EXISTS (
          SELECT 1 FROM supertag_parents sp WHERE sp.child_tag_id = sm.tag_id
        )

        UNION ALL

        -- Recursive case: children with depth + 1
        SELECT sp.child_tag_id, dc.depth + 1
        FROM supertag_parents sp
        INNER JOIN depth_calc dc ON sp.parent_tag_id = dc.tag_id
        WHERE dc.depth < 20
      )
      SELECT MAX(depth) as max_depth FROM depth_calc
    `).get() as { max_depth: number | null };

    return result?.max_depth ?? 0;
  }

  /**
   * Get visualization data with detailed field information for each node.
   * Used for UML-style diagrams that show fields.
   */
  getDataWithFields(options: VisualizationOptions = {}): VisualizationData {
    const data = this.getData(options);
    return this.enrichNodesWithFields(data);
  }

  /**
   * Get subtree with detailed field information for each node.
   * Returns null if root tag not found.
   */
  getSubtreeWithFields(
    rootTagName: string,
    maxDepth?: number
  ): VisualizationData | null {
    const data = this.getSubtree(rootTagName, maxDepth);
    if (!data) return null;
    return this.enrichNodesWithFields(data);
  }

  /**
   * Enrich visualization nodes with field details.
   * Transforms InheritedField from SupertagMetadataService to VisualizationField.
   */
  private enrichNodesWithFields(data: VisualizationData): VisualizationData {
    const metadataService = new SupertagMetadataService(this.db);

    const enrichedNodes = data.nodes.map((node) => {
      const inheritedFields = metadataService.getAllFields(node.id);

      const fields: VisualizationField[] = inheritedFields.map((f) => ({
        name: f.fieldName,
        dataType: f.inferredDataType,
        inherited: f.depth > 0,
        originTag: f.depth > 0 ? f.originTagName : undefined,
      }));

      return {
        ...node,
        fields,
      };
    });

    return {
      ...data,
      nodes: enrichedNodes,
    };
  }
}
