/**
 * Local API Client
 * Spec: F-094 tana-local API Integration
 * Tasks: T-2.1 through T-2.7
 *
 * HTTP client for Tana Desktop's local REST API at http://localhost:8262.
 * Provides typed methods for all endpoints with Zod response validation,
 * retry logic with exponential backoff, and structured error handling.
 */

import { StructuredError } from '../utils/structured-errors';
import {
  HealthResponseSchema, type HealthResponse,
  ImportResponseSchema, type ImportResponse,
  TagOperationResponseSchema, type TagOperationResponse,
  FieldContentResponseSchema, type FieldContentResponse,
  FieldOptionResponseSchema, type FieldOptionResponse,
  UpdateResponseSchema, type UpdateResponse,
  DoneResponseSchema, type DoneResponse,
  TrashResponseSchema, type TrashResponse,
  CreateTagResponseSchema, type CreateTagResponse, type CreateTagRequest,
  AddFieldToTagResponseSchema, type AddFieldToTagResponse, type AddFieldToTagRequest,
  TagSchemaResponseSchema, type TagSchemaResponse,
  TagListResponseSchema, type TagInfo,
  WorkspaceListResponseSchema, type LocalApiWorkspace,
  CalendarNodeResponseSchema, type CalendarNodeResponse, type CalendarGranularity,
  SearchResultNodeSchema, type SearchResultNode,
  ReadNodeResponseSchema, type ReadNodeResponse,
  GetChildrenResponseSchema, type GetChildrenResponse,
} from '../types/local-api';
import type { ZodSchema } from 'zod';

// =============================================================================
// Constants
// =============================================================================

/** Maximum retry attempts for transient failures */
const MAX_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff (100 * attempt^2) */
const BASE_BACKOFF_MS = 100;

/** HTTP status codes that trigger automatic retry */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

// =============================================================================
// Types
// =============================================================================

interface LocalApiClientConfig {
  endpoint: string;
  bearerToken: string;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  skipAuth?: boolean;
}

// =============================================================================
// Deep Object Serialization (OpenAPI style: deepObject, explode: true)
// =============================================================================

/**
 * Serialize a nested object into flat key-value pairs using bracket notation.
 * Used for OpenAPI deepObject query parameters.
 *
 * @example
 * serializeDeepObject('query', { textContains: 'test' }, params)
 * // params = { 'query[textContains]': 'test' }
 *
 * @example
 * serializeDeepObject('query', { and: [{ textContains: 'a' }, { is: 'done' }] }, params)
 * // params = { 'query[and][0][textContains]': 'a', 'query[and][1][is]': 'done' }
 */
function serializeDeepObject(
  prefix: string,
  obj: unknown,
  out: Record<string, string>,
): void {
  if (obj === null || obj === undefined) return;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      serializeDeepObject(`${prefix}[${i}]`, obj[i], out);
    }
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      serializeDeepObject(`${prefix}[${key}]`, value, out);
    }
  } else {
    out[prefix] = String(obj);
  }
}

// =============================================================================
// LocalApiClient
// =============================================================================

/**
 * Client for Tana Desktop's local REST API.
 *
 * Handles HTTP communication with Bearer auth, Zod response validation,
 * and automatic retry with exponential backoff for transient failures.
 */
export class LocalApiClient {
  private readonly endpoint: string;
  private readonly bearerToken: string;

  constructor(config: LocalApiClientConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.bearerToken = config.bearerToken;
  }

  // ===========================================================================
  // Core HTTP Method
  // ===========================================================================

  /**
   * Execute an HTTP request against the local API.
   *
   * Handles:
   * - Authorization header injection (unless skipAuth)
   * - JSON body serialization for POST requests
   * - Query parameter encoding for GET requests
   * - Response parsing and Zod schema validation
   * - Retry with exponential backoff for transient failures
   * - Structured error mapping for known failure modes
   */
  private async request<T>(options: RequestOptions, schema: ZodSchema<T>): Promise<T> {
    const { method, path, body, query, skipAuth } = options;

    // Build URL with query parameters
    let url = `${this.endpoint}${path}`;
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query);
      url = `${url}?${params.toString()}`;
    }

    // Build headers
    const headers: Record<string, string> = {};
    if (!skipAuth) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    // Build fetch options
    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    // Execute with retry logic
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);

        // Handle non-retryable HTTP errors immediately
        if (!response.ok && !RETRYABLE_STATUS_CODES.has(response.status)) {
          throw this.mapHttpError(response.status, url, await this.safeReadBody(response));
        }

        // Handle retryable HTTP errors
        if (!response.ok && RETRYABLE_STATUS_CODES.has(response.status)) {
          lastError = this.mapHttpError(response.status, url, await this.safeReadBody(response));
          if (attempt < MAX_RETRIES) {
            await this.backoff(attempt);
            continue;
          }
          throw lastError;
        }

        // Parse and validate successful response
        const data = await response.json();
        return schema.parse(data);
      } catch (error) {
        // Already a StructuredError from mapHttpError -- do not wrap again
        if (error instanceof StructuredError) {
          // Only retry retryable StructuredErrors on transient status codes
          if (this.isTransientError(error) && attempt < MAX_RETRIES) {
            lastError = error;
            await this.backoff(attempt);
            continue;
          }
          throw error;
        }

        // Connection refused / network errors
        if (this.isConnectionError(error)) {
          lastError = new StructuredError('LOCAL_API_UNAVAILABLE', 'Tana Desktop local API is not available. Ensure Tana Desktop is running with the Local API enabled.', {
            details: { endpoint: this.endpoint, originalError: error instanceof Error ? error.message : String(error) },
            suggestion: 'Start Tana Desktop and enable the Local API in Settings > Local API.',
            recovery: { canRetry: true, retryable: true, retryStrategy: 'exponential', maxRetries: MAX_RETRIES },
          });
          if (attempt < MAX_RETRIES) {
            await this.backoff(attempt);
            continue;
          }
          throw lastError;
        }

        // Zod validation errors or unexpected errors -- do not retry
        throw new StructuredError('API_ERROR', `Local API response validation failed: ${error instanceof Error ? error.message : String(error)}`, {
          details: { endpoint: url, method, originalError: error instanceof Error ? error.message : String(error) },
          cause: error instanceof Error ? error : undefined,
        });
      }
    }

    // Should not reach here, but guard against it
    throw lastError ?? new StructuredError('API_ERROR', 'Request failed after all retry attempts');
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /**
   * Check if the local API is available.
   * GET /health -- no auth required, never throws.
   */
  async health(): Promise<boolean> {
    try {
      await this.request(
        { method: 'GET', path: '/health', skipAuth: true },
        HealthResponseSchema,
      );
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  /**
   * Import Tana Paste content under a parent node.
   * POST /nodes/{parentNodeId}/import
   */
  async importTanaPaste(parentNodeId: string, content: string): Promise<ImportResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(parentNodeId)}/import`, body: { content } },
      ImportResponseSchema,
    );
  }

  /**
   * Update a node's name and/or description.
   * POST /nodes/{nodeId}/update
   */
  async updateNode(nodeId: string, update: { name?: string | null; description?: string | null }): Promise<UpdateResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/update`, body: update },
      UpdateResponseSchema,
    );
  }

  /**
   * Read a node's content as markdown.
   * GET /nodes/{nodeId}?maxDepth={maxDepth}
   */
  async readNode(nodeId: string, maxDepth?: number): Promise<ReadNodeResponse> {
    const query: Record<string, string> = {};
    if (maxDepth !== undefined) {
      query.maxDepth = String(maxDepth);
    }
    return this.request(
      { method: 'GET', path: `/nodes/${encodeURIComponent(nodeId)}`, query },
      ReadNodeResponseSchema,
    );
  }

  /**
   * Get children of a node with pagination.
   * GET /nodes/{nodeId}/children?limit={}&offset={}
   */
  async getChildren(nodeId: string, options?: { limit?: number; offset?: number }): Promise<GetChildrenResponse> {
    const query: Record<string, string> = {};
    if (options?.limit !== undefined) {
      query.limit = String(options.limit);
    }
    if (options?.offset !== undefined) {
      query.offset = String(options.offset);
    }
    return this.request(
      { method: 'GET', path: `/nodes/${encodeURIComponent(nodeId)}/children`, query },
      GetChildrenResponseSchema,
    );
  }

  /**
   * Search for nodes using a structured query.
   * GET /nodes/search?query[textContains]=...&limit=N
   *
   * The API uses deepObject style (OpenAPI `style: deepObject, explode: true`).
   * Query operators: textContains, textMatches, hasType, field, is, has,
   *                  created, edited, done, childOf, ownedBy, linksTo,
   *                  onDate, inWorkspace, overdue, inLibrary, and, or, not
   *
   * @example
   * // Text search
   * searchNodes({ textContains: "meeting" })
   *
   * // Combined conditions
   * searchNodes({ and: [{ textContains: "task" }, { is: "todo" }] })
   */
  async searchNodes(query: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<SearchResultNode[]> {
    const params: Record<string, string> = {};

    // Serialize query object using deepObject bracket notation
    serializeDeepObject('query', query, params);

    if (options?.limit !== undefined) {
      params.limit = String(options.limit);
    }
    if (options?.offset !== undefined) {
      params.offset = String(options.offset);
    }
    return this.request(
      { method: 'GET', path: '/nodes/search', query: params },
      SearchResultNodeSchema.array(),
    );
  }

  // ===========================================================================
  // Tag Operations on Nodes
  // ===========================================================================

  /**
   * Add tags to a node.
   * POST /nodes/{nodeId}/tags
   */
  async addTags(nodeId: string, tagIds: string[]): Promise<TagOperationResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/tags`, body: { action: 'add', tagIds } },
      TagOperationResponseSchema,
    );
  }

  /**
   * Remove tags from a node.
   * POST /nodes/{nodeId}/tags
   */
  async removeTags(nodeId: string, tagIds: string[]): Promise<TagOperationResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/tags`, body: { action: 'remove', tagIds } },
      TagOperationResponseSchema,
    );
  }

  // ===========================================================================
  // Field Operations
  // ===========================================================================

  /**
   * Set a field's content value.
   * POST /nodes/{nodeId}/fields/{attributeId}/content
   */
  async setFieldContent(nodeId: string, attributeId: string, content: string): Promise<FieldContentResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/fields/${encodeURIComponent(attributeId)}/content`, body: { content } },
      FieldContentResponseSchema,
    );
  }

  /**
   * Set a field's selected option.
   * POST /nodes/{nodeId}/fields/{attributeId}/option
   */
  async setFieldOption(nodeId: string, attributeId: string, optionId: string): Promise<FieldOptionResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/fields/${encodeURIComponent(attributeId)}/option`, body: { optionId } },
      FieldOptionResponseSchema,
    );
  }

  // ===========================================================================
  // Done / Trash Operations
  // ===========================================================================

  /**
   * Mark a node as done (checked).
   * POST /nodes/{nodeId}/done
   */
  async checkNode(nodeId: string): Promise<DoneResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/done`, body: { done: true } },
      DoneResponseSchema,
    );
  }

  /**
   * Mark a node as not done (unchecked).
   * POST /nodes/{nodeId}/done
   */
  async uncheckNode(nodeId: string): Promise<DoneResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/done`, body: { done: false } },
      DoneResponseSchema,
    );
  }

  /**
   * Move a node to trash.
   * POST /nodes/{nodeId}/trash
   */
  async trashNode(nodeId: string): Promise<TrashResponse> {
    return this.request(
      { method: 'POST', path: `/nodes/${encodeURIComponent(nodeId)}/trash`, body: {} },
      TrashResponseSchema,
    );
  }

  // ===========================================================================
  // Tag Management
  // ===========================================================================

  /**
   * Create a new tag in a workspace.
   * POST /workspaces/{workspaceId}/tags
   */
  async createTag(workspaceId: string, request: CreateTagRequest): Promise<CreateTagResponse> {
    return this.request(
      { method: 'POST', path: `/workspaces/${encodeURIComponent(workspaceId)}/tags`, body: request },
      CreateTagResponseSchema,
    );
  }

  /**
   * Add a field to a tag definition.
   * POST /tags/{tagId}/fields
   */
  async addFieldToTag(tagId: string, request: AddFieldToTagRequest): Promise<AddFieldToTagResponse> {
    return this.request(
      { method: 'POST', path: `/tags/${encodeURIComponent(tagId)}/fields`, body: request },
      AddFieldToTagResponseSchema,
    );
  }

  /**
   * Get a tag's schema as markdown.
   * GET /tags/{tagId}/schema
   */
  async getTagSchema(tagId: string): Promise<TagSchemaResponse> {
    return this.request(
      { method: 'GET', path: `/tags/${encodeURIComponent(tagId)}/schema` },
      TagSchemaResponseSchema,
    );
  }

  /**
   * List tags in a workspace.
   * GET /workspaces/{workspaceId}/tags?limit={limit}
   */
  async listTags(workspaceId: string, limit?: number): Promise<TagInfo[]> {
    const query: Record<string, string> = {};
    if (limit !== undefined) {
      query.limit = String(limit);
    }
    return this.request(
      { method: 'GET', path: `/workspaces/${encodeURIComponent(workspaceId)}/tags`, query },
      TagListResponseSchema,
    );
  }

  // ===========================================================================
  // Workspace Operations
  // ===========================================================================

  /**
   * List all workspaces.
   * GET /workspaces
   */
  async listWorkspaces(): Promise<LocalApiWorkspace[]> {
    return this.request(
      { method: 'GET', path: '/workspaces' },
      WorkspaceListResponseSchema,
    );
  }

  // ===========================================================================
  // Calendar Operations
  // ===========================================================================

  /**
   * Get the calendar node for a specific date and granularity.
   * GET /workspaces/{workspaceId}/calendar/node?granularity={}&date={}
   */
  async getCalendarNode(workspaceId: string, granularity: CalendarGranularity, date?: string): Promise<CalendarNodeResponse> {
    const query: Record<string, string> = { granularity };
    if (date !== undefined) {
      query.date = date;
    }
    return this.request(
      { method: 'GET', path: `/workspaces/${encodeURIComponent(workspaceId)}/calendar/node`, query },
      CalendarNodeResponseSchema,
    );
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map HTTP status codes to structured errors.
   */
  private mapHttpError(status: number, url: string, responseBody: string): StructuredError {
    switch (status) {
      case 401:
        return new StructuredError('AUTH_EXPIRED', 'Local API bearer token is invalid or expired.', {
          details: { status, endpoint: url },
          suggestion: 'Update the bearer token in supertag config. Get a new token from Tana Desktop > Settings > Local API.',
          recovery: { canRetry: false, retryable: false },
        });

      case 404:
        return new StructuredError('NODE_NOT_FOUND', `Resource not found: ${url}`, {
          details: { status, endpoint: url, responseBody },
          suggestion: 'Verify the node ID or resource path exists in Tana.',
          recovery: { canRetry: false, retryable: false },
        });

      default: {
        // 502/503/504 are retryable -- include that in recovery info
        const retryable = RETRYABLE_STATUS_CODES.has(status);
        return new StructuredError('API_ERROR', `Local API returned HTTP ${status}`, {
          details: { status, endpoint: url, responseBody },
          recovery: retryable
            ? { canRetry: true, retryable: true, retryStrategy: 'exponential', maxRetries: MAX_RETRIES }
            : { canRetry: false, retryable: false },
        });
      }
    }
  }

  /**
   * Check if an error is a connection-level failure (e.g. ECONNREFUSED).
   */
  private isConnectionError(error: unknown): boolean {
    if (error instanceof TypeError) {
      // fetch throws TypeError for network failures
      const msg = error.message.toLowerCase();
      return msg.includes('fetch') || msg.includes('network') || msg.includes('connect') || msg.includes('econnrefused');
    }
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('etimedout');
    }
    return false;
  }

  /**
   * Check if a StructuredError represents a transient failure worth retrying.
   */
  private isTransientError(error: StructuredError): boolean {
    if (error.code === 'LOCAL_API_UNAVAILABLE') return true;
    if (error.code === 'API_ERROR' && error.details?.status) {
      return RETRYABLE_STATUS_CODES.has(error.details.status as number);
    }
    return false;
  }

  /**
   * Sleep with exponential backoff: 100ms * attempt^2
   * Attempt 1: 100ms, Attempt 2: 400ms, Attempt 3: 900ms
   */
  private backoff(attempt: number): Promise<void> {
    const delayMs = BASE_BACKOFF_MS * attempt * attempt;
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  /**
   * Safely read response body as text, returning empty string on failure.
   */
  private async safeReadBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a LocalApiClient instance.
 *
 * @param config - Endpoint URL and bearer token
 * @returns Configured LocalApiClient
 */
export function createLocalApiClient(config: { endpoint: string; bearerToken: string }): LocalApiClient {
  return new LocalApiClient(config);
}
