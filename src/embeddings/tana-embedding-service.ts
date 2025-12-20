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
} from "resona";

// Types not yet exported from resona - define locally for now
export interface DatabaseDiagnostics {
  totalRecords: number;
  databaseSizeBytes: number;
  indexSize: number;
  version: string;
  totalRows: number;
  index?: {
    type: string;
    numPartitions: number;
    numUnindexedRows: number;
    numIndexedRows: number;
    needsRebuild: boolean;
    stalePercent: number;
  };
}

export interface MaintenanceOptions {
  skipCompaction?: boolean;
  skipCompact?: boolean;
  skipIndex?: boolean;
  skipCleanup?: boolean;
  retentionDays?: number;
  onProgress?: (step: string, details?: string) => void;
}

export interface MaintenanceResult {
  durationMs: number;
  recordsRemoved?: number;
  spaceReclaimed?: number;
  compaction?: {
    fragmentsRemoved: number;
    filesCompacted: number;
    filesCreated: number;
  };
  indexRebuilt?: boolean;
  indexStats?: {
    numPartitions: number;
    numIndexedRows: number;
  };
  cleanup?: {
    recordsRemoved: number;
    oldestRetained: string;
    bytesRemoved: number;
    versionsRemoved: number;
  };
}
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
   * Get database diagnostics
   *
   * @returns Database health information
   */
  async getDiagnostics(): Promise<DatabaseDiagnostics> {
    // TODO: Implement when resona exports getDiagnostics
    return {
      totalRecords: 0,
      databaseSizeBytes: 0,
      indexSize: 0,
      version: "unknown",
      totalRows: 0,
    };
  }

  /**
   * Run database maintenance (compaction, index rebuild, cleanup)
   *
   * @param options - Maintenance options
   * @returns Maintenance result with metrics
   */
  async maintain(options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
    // TODO: Implement when resona exports maintain
    const startTime = Date.now();
    if (options.onProgress) {
      options.onProgress("Maintenance skipped", "resona maintain() not yet implemented");
    }
    return {
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.service.close();
  }
}
