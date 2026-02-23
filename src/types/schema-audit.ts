/**
 * Schema Audit Types (F-101)
 *
 * Type definitions for the schema analysis feature.
 * Defines findings, detectors, workspace schema, and audit reports.
 */

/** Severity levels for schema findings */
export type SchemaFindingSeverity = 'error' | 'warning' | 'info';

/** A single finding from a schema detector */
export interface SchemaFinding {
  detector: string;
  severity: SchemaFindingSeverity;
  message: string;
  details: {
    tagId?: string;
    tagName?: string;
    fieldId?: string;
    fieldName?: string;
    suggestion?: string;
    relatedIds?: string[];
    fillRate?: number;
    instanceCount?: number;
  };
  tanaPaste?: string;
  /** Whether this finding can be auto-fixed by --fix */
  fixable?: boolean;
  /** Why this finding cannot be auto-fixed */
  skipReason?: string;
}

/** Result of applying a fix */
export interface FixResult {
  finding: SchemaFinding;
  action: string;
  success: boolean;
  error?: string;
}

/** Audit trail entry for logging applied fixes */
export interface AuditTrailEntry {
  timestamp: string;
  workspace: string;
  action: string;
  detector: string;
  details: Record<string, unknown>;
}

/** Detector interface — all 7 detectors implement this */
export interface SchemaDetector {
  name: string;
  description: string;
  detect(schema: WorkspaceSchema): SchemaFinding[];
}

/** Supertag with instance count */
export interface SupertagInfo {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  color: string | null;
  instanceCount: number;
  lastUsed: number | null;
}

/** Field definition with ownership */
export interface FieldInfo {
  fieldLabelId: string;
  fieldName: string;
  tagId: string;
  tagName: string;
  inferredDataType: string | null;
  targetSupertagId: string | null;
  order: number;
}

/** Inheritance relationship */
export interface InheritanceRelation {
  childTagId: string;
  parentTagId: string;
}

/** Tag application count */
export interface TagApplicationCount {
  tagId: string;
  instanceCount: number;
}

/** Field value statistics for fill-rate calculation */
export interface FieldValueStats {
  fieldName: string;
  tagId: string;
  populatedCount: number;
  totalInstances: number;
  fillRate: number;
}

/** Loaded workspace schema for analysis */
export interface WorkspaceSchema {
  supertags: SupertagInfo[];
  fields: FieldInfo[];
  inheritance: InheritanceRelation[];
  tagApplications: TagApplicationCount[];
  fieldValues: FieldValueStats[];
}

/** Audit report structure */
export interface SchemaAuditReport {
  workspace: string;
  timestamp: string;
  summary: {
    totalSupertags: number;
    totalFields: number;
    findingsCount: { error: number; warning: number; info: number };
  };
  findings: SchemaFinding[];
}
