/**
 * Graph Query Planner
 * F-102: Graph Query DSL
 *
 * Validates tag/field names against the database schema and
 * converts a GraphQueryAST into an executable QueryPlan.
 */

import { Database } from "bun:sqlite";
import type {
  GraphQueryAST,
  QueryPlan,
  QueryStep,
} from "./graph-types";

/**
 * Error thrown when validation fails during planning
 */
export class GraphPlanError extends Error {
  readonly suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "GraphPlanError";
    this.suggestion = suggestion;
  }
}

/**
 * Graph Query Planner
 *
 * Validates tag/field names against the database and builds
 * an executable QueryPlan from a GraphQueryAST.
 */
export class GraphQueryPlanner {
  constructor(private db: Database) {}

  /**
   * Plan a graph query: validate and build execution steps
   *
   * @param ast - Parsed graph query AST
   * @returns Executable query plan
   * @throws GraphPlanError on validation failures
   */
  async plan(ast: GraphQueryAST): Promise<QueryPlan> {
    // Validate primary tag
    await this.validateTagName(ast.find);

    // Validate connected tags
    for (const c of ast.connected) {
      await this.validateTagName(c.toTag);
    }

    // Validate field names in WHERE clauses
    if (ast.where) {
      await this.validateWhereFields(ast.find, ast.where);
    }

    for (const c of ast.connected) {
      if (c.where) {
        await this.validateWhereFields(c.toTag, c.where);
      }
    }

    return this.buildPlan(ast);
  }

  /**
   * Format a query plan as human-readable text
   */
  formatExplain(plan: QueryPlan): string {
    const lines: string[] = ["Execution Plan:"];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepNum = i + 1;

      switch (step.type) {
        case "find_by_tag": {
          const filterCount = step.filters.length;
          const filterText = filterCount > 0
            ? ` (with ${filterCount} filter${filterCount > 1 ? "s" : ""})`
            : "";
          lines.push(`  Step ${stepNum}: Find nodes tagged #${step.tag}${filterText}`);
          break;
        }
        case "traverse": {
          const viaText = step.viaField ? ` via "${step.viaField}"` : "";
          lines.push(
            `  Step ${stepNum}: Traverse from ${step.fromSet} → #${step.toTag}${viaText}`
          );
          break;
        }
        case "filter": {
          const condCount = step.conditions.length;
          lines.push(
            `  Step ${stepNum}: Filter ${step.resultSet} (${condCount} condition${condCount > 1 ? "s" : ""})`
          );
          break;
        }
        case "project": {
          const fieldNames = step.fields.map((f) => {
            if (f.aggregateFn) {
              return `${f.aggregateFn}(${f.fieldName}) AS ${f.alias}`;
            }
            if (f.typeAlias) {
              return `${f.typeAlias}.${f.fieldName}`;
            }
            return f.fieldName;
          });
          lines.push(`  Step ${stepNum}: Project: ${fieldNames.join(", ")}`);
          break;
        }
      }
    }

    lines.push(`Estimated hops: ${plan.estimatedHops}`);
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Internal: Plan building
  // ---------------------------------------------------------------------------

  private buildPlan(ast: GraphQueryAST): QueryPlan {
    const steps: QueryStep[] = [];

    // Step 1: find_by_tag for primary FIND clause
    steps.push({
      type: "find_by_tag",
      tag: ast.find,
      filters: ast.where ?? [],
      resultSet: "R0",
    });

    // Steps 2..N: traverse for each CONNECTED TO clause
    for (let i = 0; i < ast.connected.length; i++) {
      const c = ast.connected[i];
      steps.push({
        type: "traverse",
        fromSet: `R${i}`,
        toTag: c.toTag,
        viaField: c.viaField,
        resultSet: `R${i + 1}`,
      });

      if (c.where?.length) {
        steps.push({
          type: "filter",
          resultSet: `R${i + 1}`,
          conditions: c.where,
        });
      }
    }

    // Final step: project
    steps.push({
      type: "project",
      fields: ast.return,
    });

    return {
      steps,
      estimatedHops: ast.connected.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: Validation
  // ---------------------------------------------------------------------------

  private async validateTagName(tagName: string): Promise<void> {
    // Case-insensitive tag lookup
    const result = this.db
      .query(
        "SELECT name FROM tag_definitions WHERE LOWER(name) = LOWER(?) LIMIT 1"
      )
      .get(tagName) as { name: string } | null;

    if (!result) {
      // Find similar tag names for suggestions
      const allTags = this.db
        .query("SELECT name FROM tag_definitions ORDER BY name")
        .all() as { name: string }[];

      const suggestions = allTags
        .map((t) => t.name)
        .filter((name) => {
          const lower = name.toLowerCase();
          const target = tagName.toLowerCase();
          // Prefix match or substring match
          return lower.startsWith(target) || target.startsWith(lower) || lower.includes(target);
        })
        .slice(0, 5);

      const suggestionText = suggestions.length > 0
        ? `Did you mean: ${suggestions.join(", ")}?`
        : "Run 'supertag tags list' to see available supertags.";

      throw new GraphPlanError(
        `Supertag '${tagName}' not found.`,
        suggestionText
      );
    }
  }

  private async validateWhereFields(
    tagName: string,
    conditions: Array<{ field?: string; clauses?: unknown }>
  ): Promise<void> {
    for (const cond of conditions) {
      if ("field" in cond && cond.field) {
        await this.validateFieldName(tagName, cond.field);
      }
    }
  }

  private async validateFieldName(tagName: string, fieldName: string): Promise<void> {
    // Built-in fields that always exist
    const builtinFields = new Set(["name", "created", "updated", "id"]);
    if (builtinFields.has(fieldName.toLowerCase())) {
      return;
    }

    // Look up field in the tag's field definitions
    // Field names are stored in field_definitions associated with the tag
    const result = this.db
      .query(`
        SELECT fd.name
        FROM field_definitions fd
        JOIN tag_definitions td ON fd.tag_id = td.id
        WHERE LOWER(td.name) = LOWER(?)
          AND LOWER(fd.name) = LOWER(?)
        LIMIT 1
      `)
      .get(tagName, fieldName) as { name: string } | null;

    if (!result) {
      // Get available fields for this tag
      const availableFields = this.db
        .query(`
          SELECT fd.name
          FROM field_definitions fd
          JOIN tag_definitions td ON fd.tag_id = td.id
          WHERE LOWER(td.name) = LOWER(?)
          ORDER BY fd.name
        `)
        .all(tagName) as { name: string }[];

      if (availableFields.length > 0) {
        const fieldList = availableFields.map((f) => f.name).join(", ");
        throw new GraphPlanError(
          `Field '${fieldName}' not found on #${tagName}.`,
          `Available fields: ${fieldList}`
        );
      }
      // If no fields found, don't error — the tag might have no defined fields
      // and the user might be querying built-in attributes
    }
  }
}
