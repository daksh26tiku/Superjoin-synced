/**
 * Core TypeScript Type Definitions
 * 
 * Centralized type definitions for the sync system.
 * These types are used across services, queues, and API handlers.
 */

// =============================================================================
// Sync Direction & Status Enums
// =============================================================================

export type SyncDirection = 'SHEET_TO_DB' | 'DB_TO_SHEET';

export type SyncStatus = 'SYNCED' | 'PENDING' | 'CONFLICT' | 'ERROR';

export type ModifiedBy = 'SHEET' | 'DATABASE' | 'SYSTEM';

export type ColumnDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN';

export type ConflictResolution = 'SHEET_WINS' | 'DB_WINS' | 'MANUAL' | 'PENDING';

// =============================================================================
// Webhook Payload Types
// =============================================================================

/**
 * Payload received from Google Apps Script onEdit trigger
 */
export interface SheetWebhookPayload {
  sheetId: string;
  sheetName: string;
  row: number;
  col: number;
  value: unknown;
  oldValue?: unknown;
  timestamp: string;
  userEmail?: string;
  range?: string;
}

/**
 * Batch webhook payload for multiple cell updates
 */
export interface SheetBatchWebhookPayload {
  sheetId: string;
  sheetName: string;
  changes: Array<{
    row: number;
    col: number;
    value: unknown;
    oldValue?: unknown;
  }>;
  timestamp: string;
  userEmail?: string;
}

// =============================================================================
// Schema Registry Types
// =============================================================================

/**
 * Column mapping in the schema registry
 */
export interface SchemaColumn {
  id: number;
  sheetId: string;
  sheetName: string;
  columnIndex: number;
  columnHeader: string;
  mysqlColumnName: string;
  dataType: ColumnDataType;
  createdAt: Date;
  updatedAt: Date;
  isDeprecated: boolean;
}

/**
 * Complete schema for a synced sheet
 */
export interface SheetSchema {
  sheetId: string;
  sheetName: string;
  tableName: string;
  columns: SchemaColumn[];
  lastSyncedAt: Date | null;
}

// =============================================================================
// Sync Record Types
// =============================================================================

/**
 * Internal sync metadata columns added to every synced table
 */
export interface SyncMetadata {
  _sync_row_id: number;
  _sheet_row_number: number;
  _row_hash: string;
  _last_modified_at: Date;
  _last_modified_by: ModifiedBy;
  _sync_status: SyncStatus;
}

/**
 * A row from a synced table (dynamic columns + metadata)
 */
export type SyncedRow = SyncMetadata & Record<string, unknown>;

// =============================================================================
// Change Detection Types
// =============================================================================

/**
 * Entry in the sync_change_log table (CDC)
 */
export interface ChangeLogEntry {
  id: number;
  tableName: string;
  rowId: number;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  changedColumns: string[];
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedAt: Date;
  processed: boolean;
}

// =============================================================================
// Queue Job Types
// =============================================================================

/**
 * Job data for sheet-to-db queue
 */
export interface SheetToDbJobData {
  jobId: string;
  sheetId: string;
  sheetName: string;
  row: number;
  col: number;
  value: unknown;
  timestamp: string;
  retryCount: number;
}

/**
 * Job data for db-to-sheet queue
 */
export interface DbToSheetJobData {
  jobId: string;
  sheetId: string;
  sheetName: string;
  batchId: string;
  updates: Array<{
    row: number;
    col: number;
    value: unknown;
  }>;
  timestamp: string;
  retryCount: number;
}

// =============================================================================
// Conflict Types
// =============================================================================

/**
 * Recorded sync conflict
 */
export interface SyncConflict {
  id: number;
  sheetId: string;
  rowNumber: number;
  columnName: string;
  sheetValue: unknown;
  dbValue: unknown;
  sheetTimestamp: Date;
  dbTimestamp: Date;
  resolution: ConflictResolution;
  resolvedAt: Date | null;
  createdAt: Date;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  services: {
    mysql: {
      status: 'healthy' | 'unhealthy' | 'error';
      pool?: {
        total: number;
        idle: number;
        waiting: number;
      };
      error?: string;
    };
    redis: {
      status: 'healthy' | 'unhealthy' | 'error';
      error?: string;
    };
  };
}

/**
 * Sync status response
 */
export interface SyncStatusResponse {
  sheetId: string;
  sheetName: string;
  tableName: string;
  status: SyncStatus;
  lastSyncedAt: Date | null;
  pendingChanges: number;
  conflicts: number;
  queues: {
    sheetToDb: QueueStats;
    dbToSheet: QueueStats;
  };
}

/**
 * Queue statistics
 */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Sync configuration
 */
export interface SyncConfig {
  cooldownMs: number;
  pollIntervalMs: number;
  batchSize: number;
  rateLimitPerMin: number;
  maxRetries: number;
  retryBackoffMs: number;
}

/**
 * Google Sheets API configuration
 */
export interface GoogleSheetsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUri: string;
}
