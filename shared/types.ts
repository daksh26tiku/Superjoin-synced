/**
 * Shared Type Definitions
 * 
 * Types that are shared between backend and frontend.
 * Keep this file minimal - only include types needed by both sides.
 */

// =============================================================================
// Sync Status Types
// =============================================================================

export type SyncStatus = 'SYNCED' | 'PENDING' | 'CONFLICT' | 'ERROR';

export type SyncDirection = 'SHEET_TO_DB' | 'DB_TO_SHEET';

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

// =============================================================================
// Dashboard Types
// =============================================================================

export interface SyncedSheetInfo {
  sheetId: string;
  sheetName: string;
  tableName: string;
  status: SyncStatus;
  lastSyncedAt: string | null;
  rowCount: number;
  columnCount: number;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'error';
  mysql: 'healthy' | 'unhealthy' | 'error';
  redis: 'healthy' | 'unhealthy' | 'error';
  uptime: number;
}

export interface DashboardData {
  health: SystemHealth;
  sheets: SyncedSheetInfo[];
  queues: {
    sheetToDb: QueueStats;
    dbToSheet: QueueStats;
  };
  recentErrors: Array<{
    id: number;
    message: string;
    timestamp: string;
    sheetId?: string;
  }>;
  stats: {
    totalSyncs24h: number;
    failedSyncs24h: number;
    avgSyncTimeMs: number;
    pendingConflicts: number;
  };
}
