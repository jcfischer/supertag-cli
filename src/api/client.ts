/**
 * Tana Input API Client
 * Handles API communication with Tana's Input API
 */

import { getGlobalRateLimiter } from './rateLimit';
import { ApiError, ValidationError } from '../utils/errors';
import type { TanaApiPayload, TanaApiResponse, TanaNode, TanaApiNode } from '../types';
import { tanaNodeToApiNode } from '../formatters/json';

const MAX_NODES_PER_REQUEST = 100;
const MAX_PAYLOAD_SIZE = 5000; // characters (Tana API limit per https://tana.inc/docs/input-api)

/**
 * Tana API Client
 */
export class TanaApiClient {
  private apiToken: string;
  private apiEndpoint: string;

  constructor(apiToken: string, apiEndpoint: string) {
    this.apiToken = apiToken;
    this.apiEndpoint = apiEndpoint;
  }

  /**
   * Post nodes to Tana
   * @param targetNodeId Target node ID (INBOX, SCHEMA, or specific node)
   * @param nodes Array of TanaNode or TanaApiNode objects
   * @param verbose Enable verbose logging
   * @returns API response
   */
  async postNodes(
    targetNodeId: string,
    nodes: (TanaNode | TanaApiNode)[],
    verbose: boolean = false
  ): Promise<TanaApiResponse> {
    // Convert TanaNodes to API format (if they're not already TanaApiNode)
    const apiNodes = nodes.map(node => {
      // Check if already a TanaApiNode (has supertags array with id)
      if ('supertags' in node && Array.isArray(node.supertags)) {
        return node as TanaApiNode;
      }
      // Otherwise convert from TanaNode
      return tanaNodeToApiNode(node as TanaNode);
    });

    // Validate payload
    this.validatePayload(apiNodes);

    const payload: TanaApiPayload = {
      targetNodeId,
      nodes: apiNodes,
    };

    if (verbose) {
      console.error('📤 Posting to Tana API...');
      console.error(`   Target: ${targetNodeId}`);
      console.error(`   Nodes: ${nodes.length}`);
      console.error('');
    }

    // Wait for rate limiter
    const rateLimiter = getGlobalRateLimiter();
    await rateLimiter.wait();

    if (verbose) {
      console.error('🌐 Making API request...');
    }

    // Make API request
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = errorText;
        }

        throw new ApiError(
          `API request failed: ${response.statusText}`,
          response.status,
          errorData
        );
      }

      const data = await response.json() as { nodeIds?: string[] };

      if (verbose) {
        console.error('✅ Success!');
        console.error('');
      }

      return {
        success: true,
        nodeIds: data.nodeIds || [],
      };

    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        `API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate payload before sending
   * @param nodes Nodes to validate
   * @throws ValidationError if payload is invalid
   */
  private validatePayload(nodes: TanaApiNode[]): void {
    const errors: string[] = [];

    // Check node count
    if (nodes.length === 0) {
      errors.push('No nodes to post');
    }

    if (nodes.length > MAX_NODES_PER_REQUEST) {
      errors.push(
        `Too many nodes: ${nodes.length} (maximum: ${MAX_NODES_PER_REQUEST})`
      );
    }

    // Check payload size
    const payloadSize = JSON.stringify(nodes).length;
    if (payloadSize > MAX_PAYLOAD_SIZE) {
      errors.push(
        `Payload too large: ${payloadSize} characters (maximum: ${MAX_PAYLOAD_SIZE})`
      );
    }

    // Check node structure
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (!node.name || node.name.trim().length === 0) {
        errors.push(`Node ${i + 1} has empty name`);
      }

      if (node.name.length > 500) {
        errors.push(
          `Node ${i + 1} name too long: ${node.name.length} characters (maximum: 500)`
        );
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Payload validation failed', errors);
    }
  }

  /**
   * Test API connection
   * @returns true if connection successful
   */
  async testConnection(): Promise<boolean> {
    try {
      // Post a minimal test node to INBOX
      await this.postNodes('INBOX', [{ name: 'API Test - Connection OK' }], false);
      return true;
    } catch (error) {
      throw new ApiError(
        `Connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Create API client from configuration
 * @param apiToken API token
 * @param apiEndpoint API endpoint URL
 * @returns TanaApiClient instance
 */
export function createApiClient(apiToken: string, apiEndpoint: string): TanaApiClient {
  return new TanaApiClient(apiToken, apiEndpoint);
}
