/**
 * PAI Memory Integration Types
 * Spec: F-105 PAI Memory Integration
 * Feature: F-108
 *
 * Type definitions for PAI learning sync, context retrieval,
 * and freshness scoring between pai-seed and Tana.
 */

import { z } from 'zod';

// =============================================================================
// Learning Type
// =============================================================================

export const LEARNING_TYPES = ['pattern', 'insight', 'self_knowledge'] as const;
export type LearningType = (typeof LEARNING_TYPES)[number];

// =============================================================================
// Seed.json Schemas (External — Read-Only)
// =============================================================================

/** A single learning entry in seed.json */
export const SeedEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
  source: z.string(),
  extractedAt: z.string(),
  confirmedAt: z.string(),
  confirmed: z.boolean(),
  tags: z.array(z.string()).optional().default([]),
}).passthrough();

export type SeedEntry = z.infer<typeof SeedEntrySchema>;

/** A proposal in seed.json */
export const SeedProposalSchema = z.object({
  id: z.string(),
  type: z.enum(LEARNING_TYPES),
  content: z.string(),
  source: z.string(),
  extractedAt: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  method: z.string().optional(),
  decidedAt: z.string().optional(),
}).passthrough();

export type SeedProposal = z.infer<typeof SeedProposalSchema>;

/** The full seed.json file structure */
export const SeedFileSchema = z.object({
  version: z.string().optional(),
  identity: z.record(z.unknown()).optional(),
  learned: z.object({
    patterns: z.array(SeedEntrySchema).optional().default([]),
    insights: z.array(SeedEntrySchema).optional().default([]),
    selfKnowledge: z.array(SeedEntrySchema).optional().default([]),
  }).passthrough(),
  state: z.object({
    proposals: z.array(SeedProposalSchema).optional().default([]),
  }).passthrough().optional().default({ proposals: [] }),
}).passthrough();

export type SeedFile = z.infer<typeof SeedFileSchema>;

// =============================================================================
// Internal Types
// =============================================================================

/** A learning ready to sync to Tana */
export interface PaiLearningEntry {
  seedId: string;
  type: LearningType;
  content: string;
  source: string;
  confirmedAt: string;
  tags: string[];
}

/** Entity link resolved during sync */
export interface EntityLink {
  entityName: string;
  tanaNodeId: string;
  tagType: string;
  confidence: number;
}

/** Sync result for a single entry */
export interface SyncEntryResult {
  seedId: string;
  tanaNodeId?: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  entityLinks: EntityLink[];
  error?: string;
}

/** Overall sync result */
export interface PaiSyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  entries: SyncEntryResult[];
  lastSync: string;
}

/** Freshness assessment for a single learning */
export interface FreshnessResult {
  seedId: string;
  tanaNodeId?: string;
  content: string;
  type: string;
  confirmedAt: string;
  graphActivity?: string;
  contextualFreshness: string;
  status: 'fresh' | 'stale' | 'unknown';
  daysSinceActive: number;
  linkedEntities: Array<{ name: string; lastModified?: string }>;
}

/** Context response for pai-seed session hooks */
export interface PaiContextResponse {
  learnings: Array<{
    content: string;
    type: string;
    confirmedAt: string;
    freshness: 'fresh' | 'stale';
    linkedTo: string[];
  }>;
  relatedNodes: Array<{
    name: string;
    type: string;
    lastModified?: string;
  }>;
  tokenCount: number;
}

// =============================================================================
// ID Mapping
// =============================================================================

/** Schema tag/field ID storage */
export interface PaiSchemaIds {
  paiLearningTagId?: string;
  paiProposalTagId?: string;
  fieldIds?: Record<string, Record<string, string>>;
}

/** ID mapping file structure */
export const PaiMappingSchema = z.object({
  version: z.literal(1),
  workspace: z.string(),
  lastSync: z.string(),
  mappings: z.record(z.string(), z.string()),
  schema: z.object({
    paiLearningTagId: z.string().optional(),
    paiProposalTagId: z.string().optional(),
    fieldIds: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  }).optional(),
});

export type PaiMapping = z.infer<typeof PaiMappingSchema>;

// =============================================================================
// Service Options
// =============================================================================

export interface PaiSyncOptions {
  seedPath?: string;
  workspace?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface PaiContextOptions {
  maxTokens?: number;
  type?: LearningType;
  workspace?: string;
}

export interface FreshnessOptions {
  threshold?: number;
  type?: LearningType;
  workspace?: string;
  seedPath?: string;
}

/** Result from schema initialization */
export interface SchemaInitResult {
  created: string[];
  existing: string[];
  tagIds: Record<string, string>;
  fieldIds: Record<string, Record<string, string>>;
}
