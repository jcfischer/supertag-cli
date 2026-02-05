/**
 * Local API Read Backend Implementation
 * Spec: F-097 Live Read Backend
 * Task: T-2.1
 *
 * Implements TanaReadBackend using the tana-local REST API for live reads.
 * Wraps LocalApiClient methods and normalizes responses to canonical types.
 *
 * This backend provides real-time access to Tana data through the Desktop
 * Local API running at localhost:8262. It returns live data (isLive() = true)
 * as opposed to the SQLite backend which reads from periodic exports.
 */
import type { LocalApiClient } from './local-api-client';
import type {
  TanaReadBackend,
  ReadSearchResult,
  ReadNodeContent,
  ReadTagInfo,
  PaginatedResult,
  SearchOptions,
} from './read-backend';

// =============================================================================
// LocalApiReadBackend
// =============================================================================

/**
 * Read backend backed by Tana Desktop's Local API.
 *
 * Normalizes Local API responses to canonical TanaReadBackend types:
 * - SearchResultNode[] -> ReadSearchResult[]
 * - ReadNodeResponse -> ReadNodeContent
 * - GetChildrenResponse -> PaginatedResult<ReadNodeContent>
 * - TagInfo[] -> ReadTagInfo[]
 */
export class LocalApiReadBackend implements TanaReadBackend {
  readonly type = 'local-api' as const;

  private readonly client: LocalApiClient;
  private readonly workspaceId: string;

  constructor(client: LocalApiClient, workspaceId: string) {
    this.client = client;
    this.workspaceId = workspaceId;
  }

  /**
   * Search nodes by text content.
   *
   * Wraps client.searchNodes({ textContains: query }) and normalizes
   * SearchResultNode[] to ReadSearchResult[]. Tag names are extracted
   * from the tags[].name array. Rank is always undefined since the
   * Local API does not provide FTS ranking.
   */
  async search(query: string, options?: SearchOptions): Promise<ReadSearchResult[]> {
    const clientOptions: { limit?: number; offset?: number } = {};
    if (options?.limit !== undefined) {
      clientOptions.limit = options.limit;
    }
    if (options?.offset !== undefined) {
      clientOptions.offset = options.offset;
    }

    const results = await this.client.searchNodes(
      { textContains: query },
      Object.keys(clientOptions).length > 0 ? clientOptions : undefined,
    );

    return results.map((node) => {
      const result: ReadSearchResult = {
        id: node.id,
        name: node.name,
        tags: node.tags.map((t) => t.name),
        breadcrumb: node.breadcrumb,
        created: node.created,
      };

      if (node.description !== undefined) {
        result.description = node.description;
      }

      return result;
    });
  }

  /**
   * Read a single node's content as markdown.
   *
   * Wraps client.readNode() and normalizes ReadNodeResponse to ReadNodeContent.
   * The nodeId is passed through since the Local API response doesn't include it.
   * Null descriptions are normalized to undefined.
   */
  async readNode(nodeId: string, depth?: number): Promise<ReadNodeContent> {
    const response = await this.client.readNode(nodeId, depth);

    const content: ReadNodeContent = {
      id: nodeId,
      name: response.name ?? '',
      markdown: response.markdown,
    };

    // Normalize null -> undefined for description
    if (response.description !== null && response.description !== undefined) {
      content.description = response.description;
    }

    return content;
  }

  /**
   * Get paginated children of a node.
   *
   * Wraps client.getChildren() and normalizes ChildNode[] to ReadNodeContent[].
   * Each child gets empty markdown since the children endpoint doesn't return
   * content. Tag names are extracted from tags[].name.
   */
  async getChildren(
    nodeId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<PaginatedResult<ReadNodeContent>> {
    const response = await this.client.getChildren(nodeId, options);

    const items: ReadNodeContent[] = response.children.map((child) => {
      const item: ReadNodeContent = {
        id: child.id,
        name: child.name,
        markdown: '',
        tags: child.tags.map((t) => t.name),
      };

      if (child.description !== undefined) {
        item.description = child.description;
      }

      return item;
    });

    return {
      items,
      total: response.total,
      hasMore: response.hasMore,
    };
  }

  /**
   * List available supertags in the workspace.
   *
   * Wraps client.listTags(workspaceId) and normalizes TagInfo[] to ReadTagInfo[].
   * instanceCount is always undefined since the Local API doesn't provide it.
   */
  async listTags(options?: { limit?: number }): Promise<ReadTagInfo[]> {
    const tags = await this.client.listTags(this.workspaceId, options?.limit);

    return tags.map((tag) => {
      const result: ReadTagInfo = {
        id: tag.id,
        name: tag.name,
      };

      if (tag.color !== undefined) {
        result.color = tag.color;
      }

      return result;
    });
  }

  /**
   * Whether this backend has live (real-time) data.
   * Always true for Local API backend.
   */
  isLive(): boolean {
    return true;
  }

  /**
   * Clean up resources. No-op for Local API backend since it's stateless HTTP.
   */
  close(): void {
    // No resources to clean up — HTTP client is stateless
  }
}
