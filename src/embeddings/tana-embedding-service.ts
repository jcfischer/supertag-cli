/**
 * TanaEmbeddingService
 *
 * Thin wrapper around resona EmbeddingService for Tana-specific needs.
 * Handles:
 * - Converting ContextualizedNode[] to resona ItemToEmbed[]
 * - Mapping search results to include nodeId (Tana's ID format)
 * - Managing LanceDB database path
 */

import {
  EmbeddingService,
  OllamaProvider,
  type BatchEmbedOptions,
  type BatchEmbedResult,
  type EmbeddingStats,
  type SearchResult,
  type DatabaseDiagnostics,
  type MaintenanceOptions,
  type MaintenanceResult,
} from "resona";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type { DatabaseDiagnostics, MaintenanceOptions, MaintenanceResult };
import type { ContextualizedNode } from "./contextualize";

/**
 * Tana-specific search result with nodeId field
 */
export interface TanaSearchResult {
  /** Tana node ID */
  nodeId: string;
  /** Vector distance (lower = more similar) */
  distance: number;
  /** Similarity score (1 - distance, higher = more similar) */
  similarity: number;
}

/**
 * Options for creating TanaEmbeddingService
 */
export interface TanaEmbeddingServiceOptions {
  /** Embedding model name (default: "bge-m3") */
  model?: string;
  /** Ollama endpoint URL (default: "http://localhost:11434") */
  endpoint?: string;
}

/**
 * TanaEmbeddingService - wrapper around resona for Tana embeddings
 *
 * Delegates all storage/search to resona EmbeddingService, but accepts
 * Tana-specific ContextualizedNode[] for embedding and returns nodeId
 * in search results.
 */
export class TanaEmbeddingService {
  private service: EmbeddingService;
  private dbPath: string;

  /**
   * Create a TanaEmbeddingService
   *
   * @param dbPath - Path to LanceDB database directory
   * @param options - Optional model and endpoint configuration
   */
  constructor(dbPath: string, options: TanaEmbeddingServiceOptions = {}) {
    const model = options.model ?? "bge-m3";
    const endpoint = options.endpoint ?? "http://localhost:11434";

    // Convert .db extension to .lance for LanceDB
    this.dbPath = dbPath.replace(/\.db$/, ".lance");

    // Create Ollama provider
    const provider = new OllamaProvider(model, endpoint);

    // Create resona EmbeddingService
    this.service = new EmbeddingService(provider, this.dbPath);
  }

  /**
   * Get the database path (for debugging/testing)
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Embed contextualized Tana nodes
   *
   * @param nodes - Array of contextualized nodes from contextualize.ts
   * @param options - Batch embedding options (progress callback, forceAll, etc.)
   * @returns Batch embedding result statistics
   */
  async embedNodes(
    nodes: ContextualizedNode[],
    options: BatchEmbedOptions = {}
  ): Promise<BatchEmbedResult> {
    // Map ContextualizedNode[] to ItemToEmbed[]
    const items = nodes.map((node) => ({
      id: node.nodeId,
      text: node.nodeName,
      contextText: node.contextText,
      metadata: {
        ancestorId: node.ancestorId,
        ancestorName: node.ancestorName,
        ancestorTags: node.ancestorTags,
      },
    }));

    // Delegate to resona
    return this.service.embedBatch(items, options);
  }

  /**
   * Search for similar nodes
   *
   * Returns node IDs with similarity scores. The caller is responsible
   * for enriching results with full node data from the Tana SQLite database.
   *
   * @param query - Query text to search for
   * @param k - Number of results to return (default: 10)
   * @returns Array of search results with nodeId, distance, similarity
   */
  async search(query: string, k: number = 10): Promise<TanaSearchResult[]> {
    const results = await this.service.search(query, k);

    // Map to Tana-specific format (nodeId instead of id)
    return results.map((result) => ({
      nodeId: result.id,
      distance: result.distance,
      similarity: result.similarity,
    }));
  }

  /**
   * Get embedding statistics
   *
   * @returns Statistics about stored embeddings
   */
  async getStats(): Promise<EmbeddingStats> {
    return this.service.getStats();
  }

  /**
   * Get list of all embedded node IDs
   *
   * @returns Array of node IDs that have embeddings
   */
  async getEmbeddedIds(): Promise<string[]> {
    return this.service.getEmbeddedIds();
  }

  /**
   * Remove embeddings not in the provided ID list
   *
   * @param keepIds - List of node IDs to keep
   * @returns Number of embeddings removed
   */
  async cleanup(keepIds: string[]): Promise<number> {
    return this.service.cleanup(keepIds);
  }

  /**
   * Get database diagnostics including row count, version, and index health
   *
   * @returns Database health information
   */
  async getDiagnostics(): Promise<DatabaseDiagnostics> {
    return this.service.getDiagnostics();
  }

  /**
   * Run database maintenance (compaction, index rebuild, cleanup)
   *
   * @param options - Maintenance options
   * @returns Maintenance result with metrics
   */
  async maintain(options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
    return this.service.maintain(options);
  }

  /**
   * Get total disk size of the LanceDB database directory
   *
   * @returns Object with raw bytes and human-readable formatted string
   */
  getDiskSize(): { bytes: number; formatted: string } {
    const bytes = this.getDirectorySize(this.dbPath);
    return { bytes, formatted: formatBytes(bytes) };
  }

  /**
   * Get the number of data fragments in the LanceDB table
   *
   * Fragments are subdirectories in the data/ directory of the embeddings table.
   *
   * @returns Number of data fragments
   */
  getFragmentCount(): number {
    const dataDir = join(this.dbPath, "embeddings.lance", "data");
    try {
      const entries = readdirSync(dataDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  /**
   * Recursively sum file sizes in a directory
   */
  private getDirectorySize(dirPath: string): number {
    let totalSize = 0;
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += this.getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          totalSize += statSync(fullPath).size;
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }
    return totalSize;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.service.close();
  }
}

/**
 * Format bytes into human-readable string (KB, MB, GB)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}
