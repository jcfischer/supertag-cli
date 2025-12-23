/**
 * Tana Webhook Server
 *
 * Fastify HTTP server exposing Tana query operations as webhooks
 * Returns results in Tana Paste format for seamless insertion into Tana
 */

import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { TanaQueryEngine, type SearchResult } from "../query/tana-query-engine";
import { TanaPasteConverter } from "../converters/tana-paste";
import { semanticSearch, type SemanticSearchResult, type SemanticSearchResultItem } from "../mcp/tools/semantic-search";
import { getNodeContents, getNodeContentsWithDepth, formatNodeOutput, type NodeContents } from "../commands/show";
import { SchemaRegistry } from "../schema/registry";
import type { SemanticSearchInput } from "../mcp/schemas";
import { Database } from "bun:sqlite";
import { ConfigManager } from "../config/manager";
import { TanaEmbeddingService } from "../embeddings/tana-embedding-service";
import { withDbRetrySync } from "../db/retry";
import { VERSION } from "../version";
import { existsSync } from "node:fs";

export interface WorkspaceInfo {
  alias: string;
  dbPath: string;
}

export interface WebhookServerConfig {
  port: number;
  host?: string;
  /** Map of workspace alias -> database path */
  workspaces: Map<string, string>;
  /** Default workspace to use if none specified */
  defaultWorkspace?: string;
}

/**
 * Webhook server for Tana integration
 * Supports multiple workspaces with workspace-specific query engines
 */
export class TanaWebhookServer {
  private fastify: FastifyInstance;
  private queryEngines: Map<string, TanaQueryEngine>;
  private converter: TanaPasteConverter;
  private config: {
    port: number;
    host: string;
    workspaces: Map<string, string>;
    defaultWorkspace: string;
  };
  private running: boolean = false;

  constructor(config: WebhookServerConfig) {
    // Get default workspace (first one if not specified)
    const firstWorkspace = config.workspaces.keys().next().value;
    if (!firstWorkspace) {
      throw new Error("At least one workspace must be configured");
    }

    this.config = {
      port: config.port,
      host: config.host || "localhost",
      workspaces: config.workspaces,
      defaultWorkspace: config.defaultWorkspace || firstWorkspace,
    };

    this.fastify = Fastify({ logger: false });
    this.converter = new TanaPasteConverter();

    // Initialize query engines for all workspaces
    this.queryEngines = new Map();
    for (const [alias, dbPath] of config.workspaces) {
      this.queryEngines.set(alias, new TanaQueryEngine(dbPath));
    }

    this.setupCors();
    this.setupRoutes();
  }

  /**
   * Get query engine for a workspace
   * @param workspace - Workspace alias (uses default if not specified)
   * @returns Query engine for the workspace
   * @throws Error if workspace not found
   */
  private getQueryEngine(workspace?: string): { engine: TanaQueryEngine; alias: string; dbPath: string } {
    const alias = workspace || this.config.defaultWorkspace;
    const engine = this.queryEngines.get(alias);
    const dbPath = this.config.workspaces.get(alias);

    if (!engine || !dbPath) {
      const available = Array.from(this.config.workspaces.keys()).join(", ");
      throw new Error(`Workspace '${alias}' not found. Available: ${available}`);
    }

    return { engine, alias, dbPath };
  }

  /**
   * Get list of available workspaces
   */
  getWorkspaces(): string[] {
    return Array.from(this.config.workspaces.keys());
  }

  /**
   * Setup CORS to allow Tana browser requests
   */
  private setupCors(): void {
    this.fastify.register(cors, {
      origin: true, // Allow all origins (Tana uses browser context)
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
      credentials: false,
    });
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Help endpoint - API documentation in Tana Paste format
    this.fastify.get("/help", async (request, reply) => {
      // Support format query param (tana or json)
      const { format } = request.query as { format?: string };

      const workspaces = this.getWorkspaces();
      const defaultWs = this.config.defaultWorkspace;

      const endpoints = [
        // System endpoints
        {
          method: "GET",
          path: "/health",
          description: "Health check endpoint",
          payload: "None",
          response: 'JSON: {"status": "ok", "timestamp": <number>, "workspaces": [<aliases>]}',
          example: 'GET http://localhost:3000/health',
        },
        {
          method: "GET",
          path: "/workspaces",
          description: "List available workspaces",
          payload: "None",
          response: 'JSON: {"workspaces": [<aliases>], "default": <alias>}',
          example: "GET http://localhost:3000/workspaces",
        },
        {
          method: "GET",
          path: "/help",
          description: "API documentation (this endpoint)",
          payload: "Query param: format=tana|json (optional, default: tana)",
          response: "Tana Paste format (or JSON if format=json) with all endpoint documentation",
          example: "GET http://localhost:3000/help?format=json",
        },

        // Search (unified endpoint)
        {
          method: "POST",
          path: "/search",
          description: "Unified search endpoint supporting full-text, semantic, and tagged search",
          payload: '{"query": string (required), "type": "fts"|"semantic"|"tagged" (optional, default: "fts"), "tag": string (required if type=tagged), "workspace": string (optional), "limit": number (optional, default: 10), "format": "tana"|"json" (optional)}',
          response: "Tana Paste format (or JSON) with search results",
          example: 'POST http://localhost:3000/search\nBody: {"query": "meeting notes", "type": "semantic", "limit": 5}',
          notes: "type=semantic requires embeddings to be generated first",
        },

        // Stats (unified endpoint)
        {
          method: "GET",
          path: "/stats",
          description: "Unified statistics endpoint with type filtering",
          payload: 'Query params: workspace (optional), type=all|db|embed|filter (optional, default: all), format=tana|json (optional)',
          response: "Tana Paste format (or JSON) with statistics",
          example: "GET http://localhost:3000/stats?type=db&format=json",
        },

        // Nodes (RESTful)
        {
          method: "GET",
          path: "/nodes/:id",
          description: "Get node by ID with optional depth for child expansion",
          payload: 'Query params: workspace (optional), depth (optional, default: 0), format=tana|json (optional)',
          response: "Tana Paste format (or JSON) with node contents",
          example: "GET http://localhost:3000/nodes/abc123?depth=2&format=json",
        },
        {
          method: "GET",
          path: "/nodes/:id/refs",
          description: "Get inbound and outbound references for a node",
          payload: 'Query params: workspace (optional), format=tana|json (optional)',
          response: "Tana Paste format (or JSON) with reference graph",
          example: "GET http://localhost:3000/nodes/abc123/refs",
        },
        {
          method: "GET",
          path: "/nodes/recent",
          description: "Get recently created nodes",
          payload: 'Query params: workspace (optional), limit (optional, default: 10), format=tana|json (optional)',
          response: "Tana Paste format (or JSON) with recent nodes",
          example: "GET http://localhost:3000/nodes/recent?limit=20",
        },
        {
          method: "POST",
          path: "/nodes/find",
          description: "Find nodes by pattern or tag",
          payload: '{"workspace": string (optional), "pattern": string (optional, SQL LIKE pattern), "tag": string (optional, supertag name), "limit": number (optional, default: 10)}',
          response: "Tana Paste format with matching nodes",
          example: 'POST http://localhost:3000/nodes/find\nBody: {"pattern": "%project%", "tag": "todo"}',
        },

        // Tags (RESTful)
        {
          method: "GET",
          path: "/tags",
          description: "List all supertags with node counts",
          payload: 'Query params: workspace (optional), limit (optional, default: 50), format=tana|json (optional)',
          response: "Tana Paste format (or JSON) with supertags list",
          example: "GET http://localhost:3000/tags?limit=100&format=json",
        },
        {
          method: "GET",
          path: "/tags/top",
          description: "Get top supertags by usage count",
          payload: 'Query params: workspace (optional), limit (optional, default: 20), format=tana|json (optional)',
          response: "Tana Paste format (or JSON) with top supertags",
          example: "GET http://localhost:3000/tags/top?limit=10",
        },
        {
          method: "GET",
          path: "/tags/:name",
          description: "Get supertag schema details (fields, color, etc.)",
          payload: 'Query params: workspace (optional), format=tana|json (optional)',
          response: "Tana Paste format (or JSON) with tag schema",
          example: "GET http://localhost:3000/tags/todo?format=json",
        },

        // Legacy endpoints (deprecated, use new unified endpoints above)
        {
          method: "POST",
          path: "/semantic-search",
          description: "[DEPRECATED] Use POST /search with type=semantic instead",
          payload: '{"query": string, ...}',
          response: "Same as /search with type=semantic",
          example: "Use POST /search instead",
          notes: "Will be removed in future version",
        },
        {
          method: "GET",
          path: "/embed-stats",
          description: "[DEPRECATED] Use GET /stats?type=embed instead",
          payload: "Query params: workspace, format",
          response: "Same as /stats with type=embed",
          example: "Use GET /stats?type=embed instead",
          notes: "Will be removed in future version",
        },
        {
          method: "POST",
          path: "/refs",
          description: "[DEPRECATED] Use GET /nodes/:id/refs instead",
          payload: '{"nodeId": string, "workspace": string}',
          response: "Same as /nodes/:id/refs",
          example: "Use GET /nodes/{nodeId}/refs instead",
          notes: "Will be removed in future version",
        },
        {
          method: "POST",
          path: "/nodes",
          description: "[DEPRECATED] Use POST /nodes/find instead",
          payload: '{"pattern": string, "tag": string, ...}',
          response: "Same as /nodes/find",
          example: "Use POST /nodes/find instead",
          notes: "Will be removed in future version",
        },
        {
          method: "POST",
          path: "/tags",
          description: "[DEPRECATED] Use GET /tags or GET /tags/top instead",
          payload: '{"limit": number, ...}',
          response: "Same as GET /tags",
          example: "Use GET /tags instead",
          notes: "Will be removed in future version",
        },
      ];

      // Return JSON if requested
      if (format === "json") {
        reply.header("Content-Type", "application/json");
        return {
          server: "Tana Webhook Server",
          version: VERSION,
          description: "HTTP API for querying Tana data with results in Tana Paste format",
          workspaces: {
            available: workspaces,
            default: defaultWs,
          },
          endpoints,
          usage: {
            authentication: "None required",
            cors: "Enabled for all origins",
            workspaceParam: `All endpoints accept an optional 'workspace' parameter. Default: '${defaultWs}'`,
            responseFormat: "Most endpoints return Tana Paste format (text/plain) for seamless insertion into Tana. Use format=json query param or request body field where supported for JSON responses.",
          },
        };
      }

      // Default: Return Tana Paste format
      reply.header("Content-Type", "text/plain");

      const lines = [
        "- Tana Webhook Server API Documentation",
        `  - Version:: ${VERSION}`,
        "  - Description:: HTTP API for querying Tana data with results in Tana Paste format",
        `  - Workspaces:: ${workspaces.join(", ")} (default: ${defaultWs})`,
        "",
        "  - ## Endpoints",
      ];

      for (const endpoint of endpoints) {
        lines.push(`    - **${endpoint.method} ${endpoint.path}**`);
        lines.push(`      - Description:: ${endpoint.description}`);
        lines.push(`      - Payload:: ${endpoint.payload}`);
        lines.push(`      - Response:: ${endpoint.response}`);
        lines.push(`      - Example::`);
        // Split example into lines for better formatting
        const exampleLines = endpoint.example.split("\n");
        exampleLines.forEach((line) => {
          lines.push(`        - ${line}`);
        });
        if (endpoint.notes) {
          lines.push(`      - Notes:: ${endpoint.notes}`);
        }
        lines.push(""); // Empty line between endpoints
      }

      lines.push("  - ## Usage");
      lines.push("    - Authentication:: None required");
      lines.push("    - CORS:: Enabled for all origins");
      lines.push("    - Response Format:: Most endpoints return Tana Paste format (text/plain) for seamless insertion into Tana. Use format=json query param or request body field where supported for JSON responses.");

      return lines.join("\n");
    });

    // Health check
    this.fastify.get("/health", async (request, reply) => {
      return {
        status: "ok",
        timestamp: Date.now(),
        workspaces: this.getWorkspaces(),
        defaultWorkspace: this.config.defaultWorkspace,
      };
    });

    // Workspaces endpoint
    this.fastify.get("/workspaces", async (request, reply) => {
      return {
        workspaces: this.getWorkspaces(),
        default: this.config.defaultWorkspace,
      };
    });

    // Unified Search endpoint (T-4.1 - CLI Harmonization)
    // Supports type: 'fts' (default), 'semantic', or 'tagged'
    this.fastify.post<{
      Body: {
        query: string;
        workspace?: string;
        limit?: number;
        type?: 'fts' | 'semantic' | 'tagged';
        tag?: string;
        format?: 'tana' | 'json';
        includeContents?: boolean;
        includeAncestor?: boolean;
      };
    }>("/search", async (request, reply) => {
      const {
        query,
        workspace,
        limit = 10,
        type = 'fts',
        tag,
        format = 'tana',
        includeContents = false,
        includeAncestor = true,
      } = request.body;

      if (!query) {
        reply.status(400);
        return { error: "Query parameter required" };
      }

      try {
        const { engine, alias, dbPath } = this.getQueryEngine(workspace);

        // Handle different search types
        if (type === 'semantic') {
          // Semantic search using embeddings
          const results = await semanticSearch({
            query,
            workspace: alias,
            limit,
            includeContents,
            includeAncestor,
            raw: false,
            depth: 0,
          });

          if (format === 'json') {
            return results;
          }

          const tana = this.convertSemanticResultsToTana(results);
          reply.header("Content-Type", "text/plain");
          return tana;
        }

        if (type === 'tagged') {
          // Search by tag
          if (!tag) {
            reply.status(400);
            return { error: "tag parameter required for type=tagged search" };
          }

          const results = await engine.findNodes({
            supertag: tag,
            namePattern: `%${query}%`,
            limit,
          });

          const tanaNodes = results.map((node) => ({
            name: node.name || "(unnamed)",
            "Node ID": node.id,
            ...(node.created && {
              Created: new Date(node.created).toLocaleDateString(),
            }),
          }));

          if (format === 'json') {
            return { results: tanaNodes, count: tanaNodes.length };
          }

          const tana = this.converter.jsonToTana({
            name: `Tagged Search: #${tag} containing "${query}"`,
            children: tanaNodes,
          });

          reply.header("Content-Type", "text/plain");
          return tana;
        }

        // Default: Full-text search (FTS)
        const hasFTS = await engine.hasFTSIndex();
        if (!hasFTS) {
          await engine.initializeFTS();
        }

        const results = await engine.searchNodes(query, { limit });

        if (format === 'json') {
          return {
            results: results.map(r => ({
              id: r.id,
              name: r.name,
              rank: r.rank,
            })),
            count: results.length,
          };
        }

        // Convert to Tana Paste format matching semantic search output
        const tana = this.convertSearchResultsToTana(query, results);

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // Unified Stats endpoint (T-4.3 - CLI Harmonization)
    // Supports type: 'all' (default), 'db', 'embed', or 'filter'
    this.fastify.get<{
      Querystring: {
        workspace?: string;
        type?: 'all' | 'db' | 'embed' | 'filter';
        format?: 'tana' | 'json';
      };
    }>("/stats", async (request, reply) => {
      const { workspace, type = 'all', format = 'tana' } = request.query;

      try {
        const { engine, alias, dbPath } = this.getQueryEngine(workspace);

        // Collect stats based on type
        const result: Record<string, unknown> = {
          workspace: alias,
        };

        // Database stats
        if (type === 'all' || type === 'db') {
          const stats = await engine.getStatistics();
          result.database = {
            totalNodes: stats.totalNodes,
            totalSupertags: stats.totalSupertags,
            totalFields: stats.totalFields,
            totalReferences: stats.totalReferences,
          };
        }

        // Embedding stats
        if (type === 'all' || type === 'embed') {
          const lanceDbPath = dbPath.replace(/\.db$/, ".lance");
          if (existsSync(lanceDbPath)) {
            const configManager = ConfigManager.getInstance();
            const embeddingConfig = configManager.getEmbeddingConfig();

            const embeddingService = new TanaEmbeddingService(lanceDbPath, {
              model: embeddingConfig.model,
              endpoint: embeddingConfig.endpoint,
            });

            try {
              const embedStats = await embeddingService.getStats();
              const db = new Database(dbPath, { readonly: true });
              try {
                const totalNodes = withDbRetrySync(
                  () => db.query("SELECT COUNT(*) as count FROM nodes").get() as { count: number },
                  "stats total nodes"
                );

                const coverage = totalNodes.count > 0
                  ? ((embedStats.totalEmbeddings / totalNodes.count) * 100)
                  : 0;

                result.embeddings = {
                  model: embeddingConfig.model,
                  dimensions: embedStats.dimensions || 0,
                  totalEmbeddings: embedStats.totalEmbeddings,
                  coverage: Math.round(coverage * 10) / 10,
                };
              } finally {
                db.close();
              }
            } finally {
              embeddingService.close();
            }
          } else {
            result.embeddings = {
              configured: true,
              generated: false,
              message: "Run 'supertag embed generate' to create embeddings",
            };
          }
        }

        // Filter stats (for embedding content filtering)
        if (type === 'all' || type === 'filter') {
          const db = new Database(dbPath, { readonly: true });
          try {
            const totalNodes = withDbRetrySync(
              () => db.query("SELECT COUNT(*) as count FROM nodes WHERE node_type IS NULL OR node_type != 'trash'").get() as { count: number },
              "stats filter total"
            );

            const entities = withDbRetrySync(
              () => db.query("SELECT COUNT(*) as count FROM nodes WHERE json_extract(raw_data, '$.props._flags') % 2 = 1").get() as { count: number },
              "stats filter entities"
            );

            result.filter = {
              totalNodes: totalNodes.count,
              entities: entities.count,
              entityPercentage: Math.round((entities.count / totalNodes.count) * 1000) / 10,
            };
          } finally {
            db.close();
          }
        }

        if (format === 'json') {
          return result;
        }

        // Convert to Tana Paste format
        const children: Record<string, unknown>[] = [];

        if (result.database) {
          const dbStats = result.database as Record<string, number>;
          children.push({
            name: "Database",
            children: [
              { name: `Nodes:: ${dbStats.totalNodes.toLocaleString()}` },
              { name: `Supertags:: ${dbStats.totalSupertags.toLocaleString()}` },
              { name: `Fields:: ${dbStats.totalFields.toLocaleString()}` },
              { name: `References:: ${dbStats.totalReferences.toLocaleString()}` },
            ],
          });
        }

        if (result.embeddings) {
          const embedStats = result.embeddings as Record<string, unknown>;
          if (embedStats.generated === false) {
            children.push({
              name: "Embeddings",
              children: [
                { name: "Status:: Not Generated" },
                { name: `Message:: ${embedStats.message}` },
              ],
            });
          } else {
            children.push({
              name: "Embeddings",
              children: [
                { name: `Model:: ${embedStats.model}` },
                { name: `Dimensions:: ${embedStats.dimensions}` },
                { name: `Total:: ${(embedStats.totalEmbeddings as number).toLocaleString()}` },
                { name: `Coverage:: ${embedStats.coverage}%` },
              ],
            });
          }
        }

        if (result.filter) {
          const filterStats = result.filter as Record<string, number>;
          children.push({
            name: "Content Filter",
            children: [
              { name: `Total Nodes:: ${filterStats.totalNodes.toLocaleString()}` },
              { name: `Entities:: ${filterStats.entities.toLocaleString()}` },
              { name: `Entity Rate:: ${filterStats.entityPercentage}%` },
            ],
          });
        }

        const tana = this.converter.jsonToTana({
          name: `Statistics (${alias})`,
          children,
        });

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // RESTful Tags endpoints (T-4.4 - CLI Harmonization)

    // GET /tags - List all tags
    this.fastify.get<{
      Querystring: { workspace?: string; limit?: number; format?: 'tana' | 'json' };
    }>("/tags", async (request, reply) => {
      const { workspace, limit = 50, format = 'tana' } = request.query;

      try {
        const { engine, alias } = this.getQueryEngine(workspace);
        const tags = await engine.getTopSupertags(limit);

        if (format === 'json') {
          return {
            tags: tags.map(tag => ({
              name: tag.tagName,
              id: tag.tagId,
              count: tag.count,
            })),
            count: tags.length,
          };
        }

        const tanaNodes = tags.map((tag) => ({
          name: tag.tagName,
          "Tag ID": tag.tagId,
          Count: tag.count.toString(),
        }));

        const tana = this.converter.jsonToTana({
          name: `Supertags (${alias})`,
          children: tanaNodes,
        });

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // GET /tags/top - Top tags by usage
    this.fastify.get<{
      Querystring: { workspace?: string; limit?: number; format?: 'tana' | 'json' };
    }>("/tags/top", async (request, reply) => {
      const { workspace, limit = 20, format = 'tana' } = request.query;

      try {
        const { engine, alias } = this.getQueryEngine(workspace);
        const tags = await engine.getTopTagsByUsage(limit);

        if (format === 'json') {
          return {
            tags: tags.map(tag => ({
              name: tag.tagName,
              id: tag.tagId,
              count: tag.count,
            })),
            count: tags.length,
          };
        }

        const tanaNodes = tags.map((tag, i) => ({
          name: `${i + 1}. #${tag.tagName}`,
          Count: tag.count.toString(),
        }));

        const tana = this.converter.jsonToTana({
          name: `Top ${tags.length} Supertags (${alias})`,
          children: tanaNodes,
        });

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // GET /tags/:name - Show specific tag details
    this.fastify.get<{
      Params: { name: string };
      Querystring: { workspace?: string; format?: 'tana' | 'json' };
    }>("/tags/:name", async (request, reply) => {
      const { name: tagname } = request.params;
      const { workspace, format = 'tana' } = request.query;

      try {
        const { alias, dbPath } = this.getQueryEngine(workspace);

        // Get schema path from workspace context
        const config = ConfigManager.getInstance().getConfig();
        const schemaPath = dbPath.replace(/tana-index\.db$/, 'schema.json');

        // Load schema registry
        const registry = new SchemaRegistry(schemaPath);
        await registry.load();

        // Find the tag
        const tag = registry.findTagByName(tagname);

        if (!tag) {
          reply.status(404);
          return { error: `Supertag not found: ${tagname}` };
        }

        if (format === 'json') {
          return tag;
        }

        const children: Array<{ name: string; children?: Array<{ name: string }> }> = [
          { name: `ID:: ${tag.id}` },
          { name: `Color:: ${tag.color || "(none)"}` },
        ];

        if (tag.fields && tag.fields.length > 0) {
          children.push({
            name: `Fields (${tag.fields.length})`,
            children: tag.fields.map((field: { name: string; attributeId: string }) => ({
              name: `${field.name} (${field.attributeId})`,
            })),
          });
        } else {
          children.push({ name: "Fields:: (none)" });
        }

        const tana = this.converter.jsonToTana({
          name: `🏷️ ${tag.name}`,
          children,
        });

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // Legacy POST /tags - kept for backward compatibility
    this.fastify.post<{
      Body: { workspace?: string; limit?: number };
    }>("/tags", async (request, reply) => {
      const { workspace, limit } = request.body || {};

      try {
        const { engine, alias } = this.getQueryEngine(workspace);
        const tags = await engine.getTopSupertags(limit || 10);

        const tanaNodes = tags.map((tag) => ({
          name: tag.tagName,
          "Tag ID": tag.tagId,
          Count: tag.count.toString(),
        }));

        const tana = this.converter.jsonToTana({
          name: `Top Supertags (${alias})`,
          children: tanaNodes,
        });

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // RESTful Nodes endpoints (T-4.2 - CLI Harmonization)

    // GET /nodes/recent - Recently updated nodes
    this.fastify.get<{
      Querystring: { workspace?: string; limit?: number; format?: 'tana' | 'json' };
    }>("/nodes/recent", async (request, reply) => {
      const { workspace, limit = 10, format = 'tana' } = request.query;

      try {
        const { engine, alias, dbPath } = this.getQueryEngine(workspace);
        const db = new Database(dbPath, { readonly: true });

        try {
          const results = withDbRetrySync(
            () => db.query(`
              SELECT id, name, created
              FROM nodes
              WHERE node_type IS NULL OR node_type != 'trash'
              ORDER BY created DESC
              LIMIT ?
            `).all(limit) as Array<{ id: string; name: string | null; created: number | null }>,
            "nodes/recent"
          );

          if (format === 'json') {
            return {
              results: results.map(r => ({
                id: r.id,
                name: r.name || "(unnamed)",
                created: r.created ? new Date(r.created).toISOString() : null,
              })),
              count: results.length,
            };
          }

          const tanaNodes = results.map((node) => ({
            name: node.name || "(unnamed)",
            "Node ID": node.id,
            ...(node.created && {
              Created: new Date(node.created).toLocaleDateString(),
            }),
          }));

          const tana = this.converter.jsonToTana({
            name: `Recent Nodes (${alias})`,
            children: tanaNodes,
          });

          reply.header("Content-Type", "text/plain");
          return tana;
        } finally {
          db.close();
        }
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // GET /nodes/:id/refs - Get node references
    this.fastify.get<{
      Params: { id: string };
      Querystring: { workspace?: string; format?: 'tana' | 'json' };
    }>("/nodes/:id/refs", async (request, reply) => {
      const { id: nodeId } = request.params;
      const { workspace, format = 'tana' } = request.query;

      try {
        const { engine } = this.getQueryEngine(workspace);
        const graph = await engine.getReferenceGraph(nodeId, 1);

        if (format === 'json') {
          return {
            nodeId,
            nodeName: graph.node.name,
            outbound: graph.outbound.map(ref => ({
              nodeId: ref.reference.toNode,
              name: ref.node?.name,
              type: ref.reference.referenceType,
            })),
            inbound: graph.inbound.map(ref => ({
              nodeId: ref.reference.fromNode,
              name: ref.node?.name,
              type: ref.reference.referenceType,
            })),
          };
        }

        const outboundNodes = graph.outbound.map((ref) => ({
          name: ref.node?.name || ref.reference.toNode,
          Type: ref.reference.referenceType,
        }));

        const inboundNodes = graph.inbound.map((ref) => ({
          name: ref.node?.name || ref.reference.fromNode,
          Type: ref.reference.referenceType,
        }));

        const tanaNode = {
          name: `References for: ${graph.node.name || nodeId}`,
          children: [
            {
              name: "Outbound References",
              children: outboundNodes,
            },
            {
              name: "Inbound References",
              children: inboundNodes,
            },
          ],
        };

        const tana = this.converter.jsonToTana(tanaNode);

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        const errorMessage = (error as Error).message;
        reply.status(errorMessage.includes("Workspace") ? 400 : 404);
        return { error: errorMessage };
      }
    });

    // GET /nodes/:id - Show node by ID
    this.fastify.get<{
      Params: { id: string };
      Querystring: { workspace?: string; depth?: number; format?: 'tana' | 'json' };
    }>("/nodes/:id", async (request, reply) => {
      const { id: nodeId } = request.params;
      const { workspace, depth = 0, format = 'tana' } = request.query;

      try {
        const { dbPath } = this.getQueryEngine(workspace);
        const db = new Database(dbPath, { readonly: true });

        try {
          const contents = depth > 0
            ? getNodeContentsWithDepth(db, nodeId, 0, depth)
            : getNodeContents(db, nodeId);

          if (!contents) {
            reply.status(404);
            return { error: `Node not found: ${nodeId}` };
          }

          if (format === 'json') {
            return contents;
          }

          // formatNodeOutput handles both NodeContents and NodeContentsWithChildren
          const tana = formatNodeOutput(contents as NodeContents);
          reply.header("Content-Type", "text/plain");
          return tana;
        } finally {
          db.close();
        }
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // POST /nodes/find - Find nodes by criteria (legacy compatibility)
    this.fastify.post<{
      Body: { workspace?: string; pattern?: string; tag?: string; limit?: number };
    }>("/nodes/find", async (request, reply) => {
      const { workspace, pattern, tag, limit } = request.body || {};

      try {
        const { engine, alias } = this.getQueryEngine(workspace);
        const results = await engine.findNodes({
          namePattern: pattern,
          supertag: tag,
          limit: limit || 10,
        });

        const tanaNodes = results.map((node) => ({
          name: node.name || "(unnamed)",
          "Node ID": node.id,
          ...(node.created && {
            Created: new Date(node.created).toLocaleDateString(),
          }),
        }));

        const tana = this.converter.jsonToTana({
          name: `Query Results (${alias})`,
          children: tanaNodes,
        });

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // Legacy POST /nodes - deprecated, use POST /nodes/find or GET endpoints
    this.fastify.post<{
      Body: { workspace?: string; pattern?: string; tag?: string; limit?: number };
    }>("/nodes", async (request, reply) => {
      const { workspace, pattern, tag, limit } = request.body || {};

      try {
        const { engine, alias } = this.getQueryEngine(workspace);
        const results = await engine.findNodes({
          namePattern: pattern,
          supertag: tag,
          limit: limit || 10,
        });

        const tanaNodes = results.map((node) => ({
          name: node.name || "(unnamed)",
          "Node ID": node.id,
          ...(node.created && {
            Created: new Date(node.created).toLocaleDateString(),
          }),
        }));

        const tana = this.converter.jsonToTana({
          name: `Query Results (${alias})`,
          children: tanaNodes,
        });

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        reply.status(400);
        return { error: (error as Error).message };
      }
    });

    // References endpoint
    this.fastify.post<{
      Body: { nodeId: string; workspace?: string };
    }>("/refs", async (request, reply) => {
      const { nodeId, workspace } = request.body;

      if (!nodeId) {
        reply.status(400);
        return { error: "nodeId parameter required" };
      }

      try {
        const { engine } = this.getQueryEngine(workspace);
        const graph = await engine.getReferenceGraph(nodeId, 1);

        const outboundNodes = graph.outbound.map((ref) => ({
          name: ref.node?.name || ref.reference.toNode,
          Type: ref.reference.referenceType,
        }));

        const inboundNodes = graph.inbound.map((ref) => ({
          name: ref.node?.name || ref.reference.fromNode,
          Type: ref.reference.referenceType,
        }));

        const tanaNode = {
          name: `References for: ${graph.node.name || nodeId}`,
          children: [
            {
              name: "Outbound References",
              children: outboundNodes,
            },
            {
              name: "Inbound References",
              children: inboundNodes,
            },
          ],
        };

        const tana = this.converter.jsonToTana(tanaNode);

        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        const errorMessage = (error as Error).message;
        // Workspace not found errors should be 400, node not found should be 404
        reply.status(errorMessage.includes("Workspace") ? 400 : 404);
        return { error: errorMessage };
      }
    });

    // Semantic search endpoint
    this.fastify.post<{
      Body: SemanticSearchInput & { format?: "tana" | "json" };
    }>("/semantic-search", async (request, reply) => {
      const { format = "tana", ...searchInput } = request.body;

      if (!searchInput.query) {
        reply.status(400);
        return { error: "query parameter required" };
      }

      try {
        const results = await semanticSearch(searchInput);

        if (format === "json") {
          return results;
        }

        // Convert to Tana Paste format
        const tana = this.convertSemanticResultsToTana(results);
        reply.header("Content-Type", "text/plain");
        return tana;
      } catch (error) {
        const errorMessage = (error as Error).message;

        // Handle specific error cases with appropriate status codes
        // Check for various embedding-related errors
        const isEmbeddingError =
          errorMessage.includes("not configured") ||
          errorMessage.includes("No embeddings") ||
          errorMessage.includes("embedding_config") ||
          errorMessage.includes("sqlite-vec") ||
          errorMessage.includes("extension") ||
          errorMessage.includes("no such column") ||
          errorMessage.includes("no such table");

        if (isEmbeddingError) {
          reply.status(503);
          const errorTana = this.converter.jsonToTana({
            name: "Error: Embeddings Not Available",
            children: [
              { name: `Reason:: ${errorMessage}` },
              { name: "Setup:: Run 'supertag embed config --provider ollama --model bge-m3'" },
              { name: "Generate:: Run 'supertag embed generate'" },
            ],
          });
          reply.header("Content-Type", "text/plain");
          return errorTana;
        }

        // Generic error
        reply.status(500);
        return { error: errorMessage };
      }
    });

    // Embedding stats endpoint
    this.fastify.get<{
      Querystring: { workspace?: string; format?: "tana" | "json" };
    }>("/embed-stats", async (request, reply) => {
      const format = request.query.format || "tana";
      const workspaceParam = request.query.workspace;

      try {
        const { alias, dbPath } = this.getQueryEngine(workspaceParam);

        // Get embedding config from ConfigManager
        const configManager = ConfigManager.getInstance();
        const embeddingConfig = configManager.getEmbeddingConfig();

        // Check if LanceDB directory exists
        const lanceDbPath = dbPath.replace(/\.db$/, ".lance");
        if (!existsSync(lanceDbPath)) {
          if (format === "json") {
            return {
              configured: true,
              generated: false,
              model: embeddingConfig.model,
              message: "Embeddings not generated yet. Run: supertag embed generate",
            };
          }
          const tana = this.converter.jsonToTana({
            name: "Embedding Status",
            children: [
              { name: "Status:: Not Generated" },
              { name: `Model:: ${embeddingConfig.model}` },
              { name: "Generate:: Run 'supertag embed generate'" },
            ],
          });
          reply.header("Content-Type", "text/plain");
          return tana;
        }

        // Get stats from TanaEmbeddingService
        const embeddingService = new TanaEmbeddingService(lanceDbPath, {
          model: embeddingConfig.model,
          endpoint: embeddingConfig.endpoint,
        });

        try {
          const stats = await embeddingService.getStats();

          // Get total nodes for coverage calculation
          const db = new Database(dbPath, { readonly: true });
          try {
            const totalNodes = withDbRetrySync(
              () => db.query("SELECT COUNT(*) as count FROM nodes").get() as { count: number },
              "embed-stats total nodes"
            );

            const coverage = totalNodes.count > 0
              ? ((stats.totalEmbeddings / totalNodes.count) * 100).toFixed(1)
              : "0";

            if (format === "json") {
              return {
                workspace: alias,
                configured: true,
                generated: true,
                model: embeddingConfig.model,
                dimensions: stats.dimensions || 0,
                totalEmbeddings: stats.totalEmbeddings,
                totalNodes: totalNodes.count,
                coverage: parseFloat(coverage),
              };
            }

            const tanaNode = {
              name: `Embedding Statistics (${alias})`,
              children: [
                { name: `Workspace:: ${alias}` },
                { name: `Model:: ${embeddingConfig.model}` },
                { name: `Dimensions:: ${stats.dimensions || 0}` },
                { name: `Embeddings:: ${stats.totalEmbeddings.toLocaleString()}` },
                { name: `Total Nodes:: ${totalNodes.count.toLocaleString()}` },
                { name: `Coverage:: ${coverage}%` },
              ],
            };

            const tana = this.converter.jsonToTana(tanaNode);
            reply.header("Content-Type", "text/plain");
            return tana;
          } finally {
            db.close();
          }
        } finally {
          embeddingService.close();
        }
      } catch (error) {
        reply.status(500);
        return { error: (error as Error).message };
      }
    });
  }

  /**
   * Convert semantic search results to Tana Paste format
   * Returns table format with node as row, Ancestor and Similarity as fields
   */
  private convertSemanticResultsToTana(results: SemanticSearchResult): string {
    // Title with table marker on same line (no %%tana%% line to avoid import confusion)
    const header = `- Semantic Search Results %%view:table%%`;

    // Table rows - use node reference as row name
    const rows = results.results.map((item: SemanticSearchResultItem) => {
      const similarity = Math.round(item.similarity * 100);

      // If the name already contains a [[...]] reference, extract just the reference
      // Names may have leading "  - " that we need to strip
      let nodeRef: string;
      if (item.name.includes("[[") && item.name.includes("]]")) {
        // Extract the [[...]] part, stripping any leading whitespace/dashes
        const match = item.name.match(/\[\[.+?\]\]/);
        nodeRef = match ? match[0] : item.name.trim();
      } else {
        nodeRef = `[[${item.name}^${item.nodeId}]]`;
      }

      let row = `  - ${nodeRef}`;

      // Add ancestor if available (same logic for ancestor names)
      if (item.ancestor) {
        let ancestorRef: string;
        if (item.ancestor.name.includes("[[") && item.ancestor.name.includes("]]")) {
          const match = item.ancestor.name.match(/\[\[.+?\]\]/);
          ancestorRef = match ? match[0] : item.ancestor.name.trim();
        } else {
          ancestorRef = `[[${item.ancestor.name}^${item.ancestor.id}]]`;
        }
        row += `\n    - Ancestor:: ${ancestorRef}`;
      }

      // Add similarity percentage
      row += `\n    - Similarity:: ${similarity}%`;

      return row;
    });

    return [header, ...rows].join("\n");
  }

  /**
   * Convert FTS search results to Tana Paste format
   * Matches semantic search output format with [[Name^nodeId]] references
   */
  private convertSearchResultsToTana(query: string, results: SearchResult[]): string {
    // Title with table marker on same line (matching semantic search format)
    // Don't include query in header - the colon confuses Tana's paste parser
    const header = `- Search Results %%view:table%%`;

    // Table rows - use node reference as row name
    const rows = results.map((r) => {
      // FTS5 rank is negative (lower = better), convert to positive percentage-like score
      // Typical ranks range from -15 to 0, we'll normalize to a 0-100 scale
      const normalizedRank = Math.min(100, Math.max(0, Math.round((15 + r.rank) * 6.67)));

      const name = r.name || "(unnamed)";

      // If the name already contains a [[...]] reference, extract just the reference
      // Names may have leading "  - " that we need to strip
      let nodeRef: string;
      if (name.includes("[[") && name.includes("]]")) {
        // Extract the [[...]] part, stripping any leading whitespace/dashes
        const match = name.match(/\[\[.+?\]\]/);
        nodeRef = match ? match[0] : name.trim();
      } else {
        nodeRef = `[[${name}^${r.id}]]`;
      }

      let row = `  - ${nodeRef}`;

      // Add rank as relevance score
      row += `\n    - Relevance:: ${normalizedRank}%`;

      return row;
    });

    return [header, ...rows].join("\n");
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.fastify.listen({
      port: this.config.port,
      host: this.config.host,
    });
    this.running = true;
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.fastify.close();
    // Close all query engines
    for (const engine of this.queryEngines.values()) {
      engine.close();
    }
    this.running = false;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get server address
   */
  getAddress(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }
}
