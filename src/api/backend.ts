/**
 * Backend Abstraction for Tana API
 * Spec: F-094 tana-local API Integration
 * Task: T-3.1
 *
 * Defines the TanaBackend interface that allows switching between
 * the legacy Input API and the new Local API. All write operations
 * go through this abstraction layer.
 */
import type { TanaApiNode, TanaApiResponse } from '../types';
import type {
  UpdateResponse,
  TagOperationResponse,
  FieldContentResponse,
  FieldOptionResponse,
  DoneResponse,
  TrashResponse,
  ImportResponse,
  FieldSetMode,
} from '../types/local-api';

/**
 * Backend type discriminator
 */
export type BackendType = 'input-api' | 'local-api';

/**
 * Unified backend interface for Tana API operations.
 *
 * Two implementations:
 * - InputApiBackend: Legacy Input API (create-only)
 * - LocalApiBackend: New Local API (full CRUD)
 *
 * Consumers should check supportsMutations() before calling
 * mutation operations, or handle MUTATIONS_NOT_SUPPORTED errors.
 */
export interface TanaBackend {
  /** Which backend implementation is active */
  readonly type: BackendType;

  /**
   * Create nodes in Tana
   * Both backends support this operation.
   *
   * @param targetNodeId - Target node ID (INBOX, SCHEMA, or specific node)
   * @param nodes - Array of nodes to create
   * @param verbose - Enable verbose logging
   * @returns API response with success status and created nodeIds
   */
  createNodes(
    targetNodeId: string,
    nodes: TanaApiNode[],
    verbose?: boolean,
  ): Promise<TanaApiResponse>;

  /**
   * Whether this backend supports mutation operations
   * (updateNode, addTags, removeTags, setFieldContent, etc.)
   *
   * @returns true if mutations are supported (local-api), false otherwise (input-api)
   */
  supportsMutations(): boolean;

  // =========================================================================
  // Mutation operations (only local-api supports these)
  // InputApiBackend throws MUTATIONS_NOT_SUPPORTED for all of these
  // =========================================================================

  /**
   * Update a node's name and/or description
   * @param nodeId - Node to update
   * @param update - Fields to update (null clears the value)
   */
  updateNode(
    nodeId: string,
    update: { name?: string | null; description?: string | null },
  ): Promise<UpdateResponse>;

  /**
   * Add supertags to a node
   * @param nodeId - Node to tag
   * @param tagIds - Tag IDs to add
   */
  addTags(nodeId: string, tagIds: string[]): Promise<TagOperationResponse>;

  /**
   * Remove supertags from a node
   * @param nodeId - Node to untag
   * @param tagIds - Tag IDs to remove
   */
  removeTags(nodeId: string, tagIds: string[]): Promise<TagOperationResponse>;

  /**
   * Set field content (plain text value)
   * @param nodeId - Node owning the field
   * @param attributeId - Field attribute ID
   * @param content - Text content to set
   */
  setFieldContent(
    nodeId: string,
    attributeId: string,
    content: string,
    mode?: FieldSetMode,
  ): Promise<FieldContentResponse>;

  /**
   * Set field option (for option/select fields)
   * @param nodeId - Node owning the field
   * @param attributeId - Field attribute ID
   * @param optionId - Option ID to select
   */
  setFieldOption(
    nodeId: string,
    attributeId: string,
    optionId: string,
    mode?: FieldSetMode,
  ): Promise<FieldOptionResponse>;

  /**
   * Mark a node as done (check its checkbox)
   * @param nodeId - Node to check
   */
  checkNode(nodeId: string): Promise<DoneResponse>;

  /**
   * Mark a node as not done (uncheck its checkbox)
   * @param nodeId - Node to uncheck
   */
  uncheckNode(nodeId: string): Promise<DoneResponse>;

  /**
   * Move a node to trash
   * @param nodeId - Node to trash
   */
  trashNode(nodeId: string): Promise<TrashResponse>;
}
