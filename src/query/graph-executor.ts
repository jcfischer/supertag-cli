/**
 * Graph Query Executor
 * F-102: Graph Query DSL
 *
 * Executes a QueryPlan by orchestrating the UnifiedQueryEngine (for FIND steps)
 * and GraphTraversalService (for CONNECTED TO traversal steps).
 *
 * Does NOT write raw SQL queries — all data access goes through existing services.
 */

import { Database } from "bun:sqlite";
import { UnifiedQueryEngine } from "./unified-query-engine";
import { GraphTraversalService } from "../services/graph-traversal";
import { FieldResolver } from "../services/field-resolver";
import type { QueryAST, WhereClause, WhereGroup } from "./types";
import { isWhereGroup } from "./types";
import type {
  GraphQueryAST,
  QueryPlan,
  QueryStep,
  GraphQueryResult,
  ProjectionField,
} from "./graph-types";

/** Internal node representation within the executor */
interface NodeRecord {
  id: string;
  name: string;
  tags?: string[];
  [key: string]: unknown;
}

/** Warning threshold for large intermediate sets */
const LARGE_SET_THRESHOLD = 1000;

/**
 * Graph Query Executor
 *
 * Orchestrates existing services to execute graph query plans.
 */
export class GraphQueryExecutor {
  private queryEngine: UnifiedQueryEngine;
  private traversalService: GraphTraversalService;
  private fieldResolver: FieldResolver;
  private workspace: string;

  constructor(private db: Database, private dbPath: string, workspace = "main") {
    this.queryEngine = new UnifiedQueryEngine(db);
    this.traversalService = new GraphTraversalService(dbPath);
    this.fieldResolver = new FieldResolver(db);
    this.workspace = workspace;
  }

  /**
   * Execute a query plan and return results
   *
   * @param plan - Execution plan from the planner
   * @param ast - Original AST (for field projection and limit)
   * @param limit - Maximum results (default: 100)
   * @returns Query result with rows, columns, and metadata
   */
  async execute(
    plan: QueryPlan,
    ast: GraphQueryAST,
    limit = 100
  ): Promise<GraphQueryResult> {
    const startTime = Date.now();
    const sets = new Map<string, NodeRecord[]>();
    const joinMaps = new Map<string, Map<string, string[]>>(); // per result set: source→target IDs
    const visitedIds = new Set<string>(); // Cycle detection

    for (const step of plan.steps) {
      switch (step.type) {
        case "find_by_tag": {
          const queryAst = this.buildQueryAST(step.tag, step.filters, limit);
          const result = await this.queryEngine.execute(queryAst);
          const nodes: NodeRecord[] = result.results.map((r) => ({
            id: r.id as string,
            name: (r.name as string) ?? "",
            ...r,
          }));
          // Track visited nodes
          for (const n of nodes) {
            visitedIds.add(n.id);
          }
          sets.set(step.resultSet, nodes);
          break;
        }

        case "traverse": {
          const fromNodes = sets.get(step.fromSet) ?? [];
          const { nodes: toNodes, joinMap } = await this.traverseSet(
            fromNodes,
            step.toTag,
            step.viaField,
            ast.depth ?? 1,
            visitedIds,
            limit
          );
          sets.set(step.resultSet, toNodes);
          joinMaps.set(step.resultSet, joinMap);

          // Warn and truncate large intermediate sets
          if (toNodes.length > LARGE_SET_THRESHOLD) {
            console.error(
              `⚠️  Large intermediate result set (${toNodes.length} nodes). ` +
                `Consider adding a WHERE clause to narrow the initial FIND results.`
            );
            sets.set(step.resultSet, toNodes.slice(0, LARGE_SET_THRESHOLD));
          }
          break;
        }

        case "filter": {
          const nodes = sets.get(step.resultSet) ?? [];
          sets.set(step.resultSet, this.applyFilters(nodes, step.conditions));
          break;
        }

        case "project": {
          // Projection is handled in buildResult
          break;
        }
      }
    }

    const queryTimeMs = Date.now() - startTime;
    return this.buildResult(sets, joinMaps, ast, limit, queryTimeMs);
  }

  /**
   * Close resources
   */
  close(): void {
    this.traversalService.close();
  }

  // ---------------------------------------------------------------------------
  // Internal: Traversal
  // ---------------------------------------------------------------------------

  private async traverseSet(
    fromNodes: NodeRecord[],
    toTag: string,
    viaField: string | undefined,
    depth: number,
    visitedIds: Set<string>,
    limit: number
  ): Promise<{ nodes: NodeRecord[]; joinMap: Map<string, string[]> }> {
    const results: NodeRecord[] = [];
    const joinMap = new Map<string, string[]>(); // source node ID → target node IDs
    const toTagLower = toTag.toLowerCase();

    for (const fromNode of fromNodes) {
      if (results.length >= limit * 10) break; // Safety limit

      try {
        const traversalResult = await this.traversalService.traverse(
          {
            nodeId: fromNode.id,
            direction: "both",
            types: viaField ? ["field", "reference", "child"] : ["child", "reference", "field"],
            depth,
            limit: Math.min(limit * 2, 100),
          },
          this.workspace
        );

        for (const related of traversalResult.related) {
          // Filter by target tag (case-insensitive)
          const hasTags = related.tags?.some(
            (t) => t.toLowerCase() === toTagLower
          );
          if (!hasTags) continue;

          // VIA field filter: only include if relationship came through the specified field
          if (viaField && related.relationship.type !== "field") {
            // Non-field relationship when VIA is specified — skip
            continue;
          }

          // Track source→target association (even for already-visited nodes,
          // so multiple source nodes can claim the same target)
          const existing = joinMap.get(fromNode.id) ?? [];
          existing.push(related.id);
          joinMap.set(fromNode.id, existing);

          // Only add to results if not visited (dedup)
          if (!visitedIds.has(related.id)) {
            visitedIds.add(related.id);
            results.push({
              id: related.id,
              name: related.name,
              tags: related.tags,
            });
          }

          if (results.length >= limit * 10) break;
        }
      } catch {
        // Skip nodes that can't be traversed (e.g., deleted nodes)
        continue;
      }
    }

    return { nodes: results, joinMap };
  }

  // ---------------------------------------------------------------------------
  // Internal: Filtering
  // ---------------------------------------------------------------------------

  private applyFilters(
    nodes: NodeRecord[],
    conditions: (WhereClause | WhereGroup)[]
  ): NodeRecord[] {
    // Resolve field values for all nodes
    const nodeIds = nodes.map((n) => n.id);
    const fieldMap = this.fieldResolver.resolveFields(nodeIds, "*");

    return nodes.filter((node) => {
      const fields = fieldMap.get(node.id) ?? {};
      return conditions.every((cond) => this.evaluateCondition(node, fields, cond));
    });
  }

  private evaluateCondition(
    node: NodeRecord,
    fields: Record<string, string>,
    condition: WhereClause | WhereGroup
  ): boolean {
    if (isWhereGroup(condition)) {
      if (condition.type === "and") {
        return condition.clauses.every((c) =>
          this.evaluateCondition(node, fields, c)
        );
      }
      return condition.clauses.some((c) =>
        this.evaluateCondition(node, fields, c)
      );
    }

    const { field, operator, value } = condition;
    const nodeValue =
      field.toLowerCase() === "name"
        ? node.name
        : (fields[field] ?? (node[field] as string | undefined));

    if (nodeValue === undefined || nodeValue === null) {
      return operator === "!=" || operator === "is_empty";
    }

    const strValue = String(nodeValue);
    const compareValue = String(value);

    switch (operator) {
      case "=":
        return strValue.toLowerCase() === compareValue.toLowerCase();
      case "!=":
        return strValue.toLowerCase() !== compareValue.toLowerCase();
      case ">":
        return strValue > compareValue;
      case "<":
        return strValue < compareValue;
      case ">=":
        return strValue >= compareValue;
      case "<=":
        return strValue <= compareValue;
      case "~":
      case "contains":
        return strValue.toLowerCase().includes(compareValue.toLowerCase());
      case "exists":
        return true;
      case "is_empty":
        return strValue === "";
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Result building
  // ---------------------------------------------------------------------------

  private buildQueryAST(
    tag: string,
    filters: (WhereClause | WhereGroup)[],
    limit: number
  ): QueryAST {
    return {
      find: tag,
      where: filters.length > 0 ? filters : undefined,
      limit,
    };
  }

  private buildResult(
    sets: Map<string, NodeRecord[]>,
    joinMaps: Map<string, Map<string, string[]>>,
    ast: GraphQueryAST,
    limit: number,
    queryTimeMs: number
  ): GraphQueryResult {
    // Always use R0 (primary FIND set) as the base result
    let resultNodes = sets.get("R0") ?? [];

    // If CONNECTED TO clauses exist, filter R0 to only nodes that have
    // live connections in the first connected set (after WHERE filtering)
    if (ast.connected.length > 0) {
      const firstJoinMap = joinMaps.get("R1");
      if (firstJoinMap) {
        const r1LiveIds = new Set((sets.get("R1") ?? []).map((n) => n.id));
        resultNodes = resultNodes.filter((n) => {
          const targets = firstJoinMap.get(n.id) ?? [];
          return targets.some((t) => r1LiveIds.has(t));
        });
      }
    }

    // Build column names from RETURN clause
    const columns = ast.return.map((f) => {
      if (f.alias) return f.alias;
      if (f.typeAlias) return `${f.typeAlias}.${f.fieldName}`;
      return f.fieldName;
    });

    // Resolve field values for primary nodes
    const nodeIds = resultNodes.map((n) => n.id);
    const fieldMap = this.fieldResolver.resolveFields(nodeIds, "*");

    // Pre-resolve fields for connected sets used in dot-notation projections
    const connectedFieldMaps = new Map<string, Map<string, Record<string, string>>>();
    for (const proj of ast.return) {
      if (proj.typeAlias && !proj.aggregateFn) {
        const setName = this.findSetForTypeAlias(proj.typeAlias, ast);
        if (setName && !connectedFieldMaps.has(setName)) {
          const connectedNodes = sets.get(setName) ?? [];
          const connectedIds = connectedNodes.map((n) => n.id);
          connectedFieldMaps.set(setName, this.fieldResolver.resolveFields(connectedIds, "*"));
        }
      }
    }

    // Index connected nodes by ID for fast lookup
    const connectedNodeIndex = new Map<string, NodeRecord>();
    for (const [, nodes] of sets) {
      for (const n of nodes) {
        connectedNodeIndex.set(n.id, n);
      }
    }

    // Build rows with projected fields
    const allRows: Record<string, unknown>[] = [];

    for (const node of resultNodes) {
      const fields = fieldMap.get(node.id) ?? {};
      const row: Record<string, unknown> = {};

      for (const proj of ast.return) {
        if (proj.fieldName === "*") {
          // Wildcard: include all fields
          row["id"] = node.id;
          row["name"] = node.name;
          if (node.tags) row["tags"] = node.tags;
          for (const [k, v] of Object.entries(fields)) {
            row[k] = v;
          }
          continue;
        }

        if (proj.aggregateFn) {
          // Aggregation — handled separately
          continue;
        }

        const colName = proj.alias ?? (proj.typeAlias ? `${proj.typeAlias}.${proj.fieldName}` : proj.fieldName);

        if (proj.typeAlias) {
          // Dot notation: resolve from connected nodes for THIS specific row
          const connectedSetName = this.findSetForTypeAlias(proj.typeAlias, ast);
          if (connectedSetName) {
            const joinMap = joinMaps.get(connectedSetName);
            const connectedIds = joinMap?.get(node.id) ?? [];
            // Only include IDs that survived filtering
            const liveIds = new Set((sets.get(connectedSetName) ?? []).map((n) => n.id));
            const rowConnectedIds = connectedIds.filter((id) => liveIds.has(id));

            const connFields = connectedFieldMaps.get(connectedSetName);
            const values: string[] = [];
            for (const cid of rowConnectedIds) {
              if (proj.fieldName.toLowerCase() === "name") {
                const cn = connectedNodeIndex.get(cid);
                if (cn) values.push(cn.name);
              } else {
                const cf = connFields?.get(cid);
                if (cf && cf[proj.fieldName]) {
                  values.push(cf[proj.fieldName]);
                }
              }
            }
            row[colName] = values.length === 0 ? null : values.length === 1 ? values[0] : values;
          }
        } else {
          // Simple field: resolve from the primary result node
          if (proj.fieldName.toLowerCase() === "name") {
            row[colName] = node.name;
          } else if (proj.fieldName.toLowerCase() === "id") {
            row[colName] = node.id;
          } else {
            row[colName] = fields[proj.fieldName] ?? null;
          }
        }
      }

      allRows.push(row);
    }

    // Handle aggregate projections
    const hasAggregates = ast.return.some((f) => f.aggregateFn);
    if (hasAggregates) {
      return this.buildAggregateResult(sets, ast, allRows, columns, queryTimeMs);
    }

    // Apply limit
    const limitedRows = allRows.slice(0, limit);
    const hasMore = allRows.length > limit;

    return {
      rows: limitedRows,
      columns,
      count: limitedRows.length,
      hasMore,
      queryTimeMs,
    };
  }

  private findSetForTypeAlias(
    typeAlias: string,
    ast: GraphQueryAST
  ): string | null {
    // Check if typeAlias matches the primary FIND tag
    if (ast.find.toLowerCase() === typeAlias.toLowerCase()) {
      return "R0";
    }

    // Check connected clauses
    for (let i = 0; i < ast.connected.length; i++) {
      if (ast.connected[i].toTag.toLowerCase() === typeAlias.toLowerCase()) {
        return `R${i + 1}`;
      }
    }

    return null;
  }

  private buildAggregateResult(
    sets: Map<string, NodeRecord[]>,
    ast: GraphQueryAST,
    _baseRows: Record<string, unknown>[],
    columns: string[],
    queryTimeMs: number
  ): GraphQueryResult {
    // Simple aggregate: COUNT
    const rows: Record<string, unknown>[] = [];

    for (const proj of ast.return) {
      if (proj.aggregateFn === "COUNT") {
        const setName = this.findSetForTypeAlias(proj.fieldName, ast);
        const count = setName ? (sets.get(setName) ?? []).length : 0;
        const alias = proj.alias ?? `count_${proj.fieldName}`;
        rows.push({ [alias]: count });
      }
    }

    // If there are non-aggregate fields, merge them
    if (rows.length === 0) {
      rows.push({});
    }

    return {
      rows,
      columns,
      count: rows.length,
      hasMore: false,
      queryTimeMs,
    };
  }
}
