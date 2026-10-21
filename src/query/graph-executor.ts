/**
 * Graph Query Executor
 * F-102: Graph Query DSL
 *
 * Executes a QueryPlan by orchestrating the UnifiedQueryEngine (for FIND steps)
 * and the set-based edge queries in db/graph-edges (for CONNECTED TO steps).
 *
 * Does NOT write raw SQL queries — all data access goes through existing services.
 */

import { Database } from "bun:sqlite";
import { UnifiedQueryEngine } from "./unified-query-engine";
import { findNeighborEdges, filterNodesByTag, loadNodeSummaries } from "../db/graph-edges";
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

/** FIND page size when CONNECTED TO clauses filter the primary set */
const FIND_PAGE_SIZE = 5000;

/**
 * Graph Query Executor
 *
 * Orchestrates existing services to execute graph query plans.
 */
export class GraphQueryExecutor {
  private queryEngine: UnifiedQueryEngine;
  private fieldResolver: FieldResolver;
  private findPageSize: number;

  constructor(private db: Database, options: { findPageSize?: number } = {}) {
    this.queryEngine = new UnifiedQueryEngine(db);
    this.fieldResolver = new FieldResolver(db);
    this.findPageSize = options.findPageSize ?? FIND_PAGE_SIZE;
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

    // Without CONNECTED TO, the FIND step alone is the result. With it, page
    // through the FIND set until `limit` connected rows exist, so matches
    // past the first page are not lost (#99).
    const hasTraversal = ast.connected.length > 0;
    const hasAggregates = ast.return.some((f) => f.aggregateFn);
    const pageSize = hasTraversal ? this.findPageSize : limit;

    for (let offset = 0; ; offset += pageSize) {
      const pageCount = await this.executePage(plan, ast, pageSize, offset, sets, joinMaps, visitedIds);
      if (!hasTraversal || pageCount < pageSize) break;
      if (!hasAggregates && this.connectedPrimaryCount(sets, joinMaps) > limit) break;
    }

    const r1Size = sets.get("R1")?.length ?? 0;
    if (r1Size > LARGE_SET_THRESHOLD) {
      console.error(
        `⚠️  Large intermediate result set (${r1Size} nodes). ` +
          `Consider adding a WHERE clause to narrow the initial FIND results.`
      );
    }

    const queryTimeMs = Date.now() - startTime;
    return this.buildResult(sets, joinMaps, ast, limit, queryTimeMs);
  }

  /**
   * Run every plan step for one page of the FIND set, merging the page's
   * result sets and join maps into the accumulators.
   *
   * @returns Number of nodes the FIND step returned for this page
   */
  private async executePage(
    plan: QueryPlan,
    ast: GraphQueryAST,
    pageSize: number,
    offset: number,
    sets: Map<string, NodeRecord[]>,
    joinMaps: Map<string, Map<string, string[]>>,
    visitedIds: Set<string>
  ): Promise<number> {
    const pageSets = new Map<string, NodeRecord[]>();
    let findCount = 0;

    for (const step of plan.steps) {
      switch (step.type) {
        case "find_by_tag": {
          const queryAst = this.buildQueryAST(step.tag, step.filters, pageSize, offset);
          const result = await this.queryEngine.execute(queryAst);
          const nodes: NodeRecord[] = result.results.map((r) => ({
            id: r.id as string,
            name: (r.name as string) ?? "",
            ...r,
          }));
          findCount = nodes.length;
          // Track visited nodes
          for (const n of nodes) {
            visitedIds.add(n.id);
          }
          pageSets.set(step.resultSet, nodes);
          break;
        }

        case "traverse": {
          const fromNodes = pageSets.get(step.fromSet) ?? [];
          const { nodes: toNodes, joinMap } = this.traverseSet(
            fromNodes,
            step.toTag,
            step.viaField,
            ast.depth ?? 1,
            visitedIds
          );
          pageSets.set(step.resultSet, toNodes);

          const merged = joinMaps.get(step.resultSet) ?? new Map<string, string[]>();
          for (const [source, targets] of joinMap) {
            merged.set(source, [...(merged.get(source) ?? []), ...targets]);
          }
          joinMaps.set(step.resultSet, merged);
          break;
        }

        case "filter": {
          const nodes = pageSets.get(step.resultSet) ?? [];
          pageSets.set(step.resultSet, this.applyFilters(nodes, step.conditions));
          break;
        }

        case "project": {
          // Projection is handled in buildResult
          break;
        }
      }
    }

    for (const [name, nodes] of pageSets) {
      sets.set(name, [...(sets.get(name) ?? []), ...nodes]);
    }

    return findCount;
  }

  /** Number of primary (R0) nodes with a live connection into R1 */
  private connectedPrimaryCount(
    sets: Map<string, NodeRecord[]>,
    joinMaps: Map<string, Map<string, string[]>>
  ): number {
    const joinMap = joinMaps.get("R1");
    if (!joinMap) return 0;
    const live = new Set((sets.get("R1") ?? []).map((n) => n.id));
    return (sets.get("R0") ?? []).filter((n) =>
      (joinMap.get(n.id) ?? []).some((t) => live.has(t))
    ).length;
  }

  // ---------------------------------------------------------------------------
  // Internal: Traversal
  // ---------------------------------------------------------------------------

  /**
   * Breadth-first expansion from `fromNodes`, `depth` hops out, collecting
   * nodes tagged `toTag`. Every hop is one set-based edge query, and the tag
   * filter runs on the full hop, so nothing is cut before filtering.
   */
  private traverseSet(
    fromNodes: NodeRecord[],
    toTag: string,
    viaField: string | undefined,
    depth: number,
    visitedIds: Set<string>
  ): { nodes: NodeRecord[]; joinMap: Map<string, string[]> } {
    const joinMap = new Map<string, string[]>(); // source node ID → target node IDs
    const matched = new Map<string, Set<string>>(); // source node ID → target node IDs

    // frontier node → source nodes it was reached from
    let frontier = new Map<string, Set<string>>(
      fromNodes.map((n) => [n.id, new Set([n.id])])
    );
    const seen = new Set(frontier.keys());

    for (let hop = 0; hop < depth && frontier.size > 0; hop++) {
      const edges = findNeighborEdges(this.db, [...frontier.keys()], { viaField });
      const tagged = filterNodesByTag(
        this.db,
        edges.map((e) => e.targetId),
        toTag
      );

      const next = new Map<string, Set<string>>();
      for (const edge of edges) {
        const origins = frontier.get(edge.sourceId);
        if (!origins) continue;

        if (tagged.has(edge.targetId)) {
          for (const origin of origins) {
            if (origin === edge.targetId) continue;
            const targets = matched.get(origin) ?? new Set<string>();
            targets.add(edge.targetId);
            matched.set(origin, targets);
          }
        }

        if (!seen.has(edge.targetId)) {
          const reachedFrom = next.get(edge.targetId) ?? new Set<string>();
          for (const origin of origins) reachedFrom.add(origin);
          next.set(edge.targetId, reachedFrom);
        }
      }

      for (const id of next.keys()) seen.add(id);
      frontier = next;
    }

    const targetIds = new Set<string>();
    for (const [origin, targets] of matched) {
      joinMap.set(origin, [...targets]);
      for (const t of targets) targetIds.add(t);
    }

    const summaries = loadNodeSummaries(this.db, [...targetIds]);
    const results: NodeRecord[] = [];
    for (const id of targetIds) {
      // Only add to results if not visited (dedup); the join map still
      // records the association so several sources can claim one target
      if (visitedIds.has(id)) continue;
      const summary = summaries.get(id);
      if (!summary) continue;
      visitedIds.add(id);
      results.push({ id, name: summary.name, tags: summary.tags });
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
    limit: number,
    offset: number
  ): QueryAST {
    return {
      find: tag,
      where: filters.length > 0 ? filters : undefined,
      limit,
      offset: offset > 0 ? offset : undefined,
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
