/**
 * Input API Backend Implementation
 * Spec: F-094 tana-local API Integration
 * Task: T-3.2
 *
 * Wraps the existing TanaApiClient as a TanaBackend.
 * Only supports createNodes -- all mutation operations throw
 * MUTATIONS_NOT_SUPPORTED since the Input API is write-only.
 */
import type { TanaApiNode, TanaApiResponse } from '../types';
import type {
  UpdateResponse,
  TagOperationResponse,
  FieldContentResponse,
  FieldOptionResponse,
  FieldSetMode,
  DoneResponse,
  TrashResponse,
} from '../types/local-api';
import type { TanaBackend } from './backend';
import { TanaApiClient } from './client';
import { StructuredError } from '../utils/structured-errors';

/**
 * Create a StructuredError for unsupported mutation operations.
 * Provides actionable guidance to configure the Local API.
 */
function mutationNotSupported(operation: string): StructuredError {
  return new StructuredError(
    "MUTATIONS_NOT_SUPPORTED",
    `Operation "${operation}" is not supported by the Input API`,
    {
      suggestion:
        "The Input API only supports creating nodes.\n" +
        "To use mutation operations (update, tag, field, check, trash),\n" +
        "configure the Local API:\n" +
        "  supertag config --bearer-token <token>\n\n" +
        "Get your bearer token from Tana Desktop > Settings > Local API.",
      details: { operation, backend: "input-api" },
      recovery: { canRetry: false },
    },
  );
}

/**
 * Backend implementation using the legacy Tana Input API.
 *
 * Capabilities:
 * - createNodes: delegates to TanaApiClient.postNodes()
 *
 * Limitations:
 * - No mutation support (update, tag, field, check, trash)
 * - No node reading (the Input API is write-only)
 */
export class InputApiBackend implements TanaBackend {
  readonly type = 'input-api' as const;

  private client: TanaApiClient;

  constructor(apiToken: string, apiEndpoint: string) {
    this.client = new TanaApiClient(apiToken, apiEndpoint);
  }

  async createNodes(
    targetNodeId: string,
    nodes: TanaApiNode[],
    verbose?: boolean,
  ): Promise<TanaApiResponse> {
    return this.client.postNodes(targetNodeId, nodes, verbose);
  }

  supportsMutations(): boolean {
    return false;
  }

  async updateNode(
    _nodeId: string,
    _update: { name?: string | null; description?: string | null },
  ): Promise<UpdateResponse> {
    throw mutationNotSupported("updateNode");
  }

  async addTags(
    _nodeId: string,
    _tagIds: string[],
  ): Promise<TagOperationResponse> {
    throw mutationNotSupported("addTags");
  }

  async removeTags(
    _nodeId: string,
    _tagIds: string[],
  ): Promise<TagOperationResponse> {
    throw mutationNotSupported("removeTags");
  }

  async setFieldContent(
    _nodeId: string,
    _attributeId: string,
    _content: string,
    _mode?: FieldSetMode,
  ): Promise<FieldContentResponse> {
    throw mutationNotSupported("setFieldContent");
  }

  async setFieldOption(
    _nodeId: string,
    _attributeId: string,
    _optionId: string,
    _mode?: FieldSetMode,
  ): Promise<FieldOptionResponse> {
    throw mutationNotSupported("setFieldOption");
  }

  async checkNode(_nodeId: string): Promise<DoneResponse> {
    throw mutationNotSupported("checkNode");
  }

  async uncheckNode(_nodeId: string): Promise<DoneResponse> {
    throw mutationNotSupported("uncheckNode");
  }

  async trashNode(_nodeId: string): Promise<TrashResponse> {
    throw mutationNotSupported("trashNode");
  }
}
