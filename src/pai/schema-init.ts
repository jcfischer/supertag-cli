/**
 * PAI Schema Initialization
 * Spec: F-105 PAI Memory Integration
 * Task: T-2.1
 *
 * Creates #pai_learning and #pai_proposal supertags in a Tana workspace
 * via the Local API. Requires Tana Desktop to be running.
 */

import { ConfigManager } from '../config/manager';
import { LocalApiClient } from '../api/local-api-client';
import { StructuredError } from '../utils/structured-errors';
import { loadMapping, saveMapping } from './mapping';
import type { SchemaInitResult } from '../types/pai';
import type { AddFieldToTagRequest } from '../types/local-api';

// =============================================================================
// Schema Definitions
// =============================================================================

/** Field definitions for #pai_learning supertag */
const PAI_LEARNING_FIELDS: AddFieldToTagRequest[] = [
  { name: 'Type', dataType: 'options', options: ['pattern', 'insight', 'self_knowledge'], isMultiValue: false },
  { name: 'Content', dataType: 'plain', isMultiValue: false },
  { name: 'Confidence', dataType: 'number', isMultiValue: false },
  { name: 'Source', dataType: 'plain', isMultiValue: false },
  { name: 'Confirmed At', dataType: 'date', isMultiValue: false },
  { name: 'Seed Entry ID', dataType: 'plain', isMultiValue: false },
  { name: 'Related People', dataType: 'plain', isMultiValue: true },
  { name: 'Related Projects', dataType: 'plain', isMultiValue: true },
];

/** Field definitions for #pai_proposal supertag */
const PAI_PROPOSAL_FIELDS: AddFieldToTagRequest[] = [
  { name: 'Status', dataType: 'options', options: ['pending', 'accepted', 'rejected'], isMultiValue: false },
  { name: 'Confidence', dataType: 'number', isMultiValue: false },
  { name: 'Extracted From', dataType: 'plain', isMultiValue: false },
  { name: 'Decided At', dataType: 'date', isMultiValue: false },
  { name: 'Content', dataType: 'plain', isMultiValue: false },
];

// =============================================================================
// Public API
// =============================================================================

interface SchemaInitOptions {
  workspace?: string;
  dryRun?: boolean;
}

/**
 * Create #pai_learning and #pai_proposal supertags in Tana workspace.
 * Idempotent: checks if tags exist before creating.
 * Requires Local API (Tana Desktop running).
 */
export async function initPaiSchema(options: SchemaInitOptions = {}): Promise<SchemaInitResult> {
  const { dryRun = false } = options;

  const result: SchemaInitResult = {
    created: [],
    existing: [],
    tagIds: {},
    fieldIds: {},
  };

  if (dryRun) {
    result.created = ['pai_learning', 'pai_proposal'];
    result.fieldIds.pai_learning = Object.fromEntries(
      PAI_LEARNING_FIELDS.map((f) => [f.name, `(dry-run-field-id)`]),
    );
    result.fieldIds.pai_proposal = Object.fromEntries(
      PAI_PROPOSAL_FIELDS.map((f) => [f.name, `(dry-run-field-id)`]),
    );
    result.tagIds.pai_learning = '(dry-run-tag-id)';
    result.tagIds.pai_proposal = '(dry-run-tag-id)';
    return result;
  }

  // Get Local API client
  const client = getLocalApiClient();

  // Get workspace ID from local API
  const workspaces = await client.listWorkspaces();
  if (workspaces.length === 0) {
    throw new StructuredError('WORKSPACE_NOT_FOUND', 'No workspaces found in Tana', {
      suggestion: 'Ensure Tana Desktop is running and has at least one workspace',
    });
  }
  const workspaceId = workspaces[0].id;

  // Load existing mapping to check for previously created tags
  const mapping = loadMapping(options.workspace);

  // Check/create #pai_learning
  const learningTagId = await ensureTag(
    client, workspaceId, 'pai_learning', PAI_LEARNING_FIELDS, mapping.schema?.paiLearningTagId, result,
  );

  // Check/create #pai_proposal
  const proposalTagId = await ensureTag(
    client, workspaceId, 'pai_proposal', PAI_PROPOSAL_FIELDS, mapping.schema?.paiProposalTagId, result,
  );

  // Save tag IDs to mapping
  mapping.schema = {
    ...mapping.schema,
    paiLearningTagId: learningTagId,
    paiProposalTagId: proposalTagId,
    fieldIds: result.fieldIds,
  };
  saveMapping(mapping);

  return result;
}

// =============================================================================
// Internal Helpers
// =============================================================================

function getLocalApiClient(): LocalApiClient {
  const configManager = ConfigManager.getInstance();
  const localApiConfig = configManager.getLocalApiConfig();

  if (!localApiConfig.bearerToken) {
    throw new StructuredError('LOCAL_API_UNAVAILABLE',
      'PAI schema initialization requires Tana Desktop with Local API enabled', {
        suggestion: 'Start Tana Desktop and configure: supertag config --bearer-token <token>',
      });
  }

  return new LocalApiClient({
    endpoint: localApiConfig.endpoint,
    bearerToken: localApiConfig.bearerToken,
  });
}

async function ensureTag(
  client: LocalApiClient,
  workspaceId: string,
  tagName: string,
  fields: AddFieldToTagRequest[],
  existingTagId: string | undefined,
  result: SchemaInitResult,
): Promise<string> {
  let tagId = existingTagId;

  // Try to find existing tag by searching
  if (!tagId) {
    try {
      const tags = await client.listTags(workspaceId, 200);
      const existing = tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
      if (existing) {
        tagId = existing.id;
      }
    } catch {
      // Ignore search errors, proceed with creation
    }
  }

  if (tagId) {
    result.existing.push(tagName);
    result.tagIds[tagName] = tagId;
    // Still ensure fieldIds are populated for existing tags
    if (!result.fieldIds[tagName]) {
      result.fieldIds[tagName] = {};
    }
    return tagId;
  }

  // Create the tag
  const tagResponse = await client.createTag(workspaceId, {
    name: tagName,
    description: `PAI ${tagName.replace('pai_', '')} supertag for AI memory integration`,
  });
  tagId = tagResponse.tagId;
  result.created.push(tagName);
  result.tagIds[tagName] = tagId;
  result.fieldIds[tagName] = {};

  // Add fields to the tag
  for (const field of fields) {
    try {
      const fieldResponse = await client.addFieldToTag(tagId, field);
      result.fieldIds[tagName][field.name] = fieldResponse.fieldId;
    } catch (err) {
      // Log field creation failure but don't fail entire init
      // Field may already exist from a partial previous run
    }
  }

  return tagId;
}
