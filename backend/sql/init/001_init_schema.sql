-- =============================================================================
-- Initial Database Schema for Sheets-MySQL Sync
-- This file is automatically executed when the MySQL container starts
-- =============================================================================

-- Use the sync database
USE sheets_sync;

-- -----------------------------------------------------------------------------
-- Schema Registry Table
-- Maps dynamic Sheet columns to MySQL columns
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_schema_registry (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sheet_id VARCHAR(255) NOT NULL COMMENT 'Google Sheet ID',
    sheet_name VARCHAR(255) NOT NULL COMMENT 'Tab/Sheet name within the spreadsheet',
    column_index INT NOT NULL COMMENT '0-based column position in Sheet',
    column_header VARCHAR(255) NOT NULL COMMENT 'Header name from Sheet (Row 1)',
    mysql_column_name VARCHAR(64) NOT NULL COMMENT 'Sanitized SQL-safe column name',
    data_type ENUM('TEXT', 'NUMBER', 'DATE', 'BOOLEAN') DEFAULT 'TEXT' COMMENT 'Detected/configured data type',
    is_deprecated BOOLEAN DEFAULT FALSE COMMENT 'Soft delete flag for removed columns',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY idx_sheet_column (sheet_id, sheet_name, column_index),
    INDEX idx_sheet_lookup (sheet_id, sheet_name),
    INDEX idx_mysql_column (mysql_column_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Synced Sheets Registry
-- Tracks all sheets that are configured for sync
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_sheets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sheet_id VARCHAR(255) NOT NULL COMMENT 'Google Sheet ID',
    sheet_name VARCHAR(255) NOT NULL COMMENT 'Tab/Sheet name',
    mysql_table_name VARCHAR(64) NOT NULL COMMENT 'Generated MySQL table name',
    sync_enabled BOOLEAN DEFAULT TRUE COMMENT 'Enable/disable sync for this sheet',
    last_synced_at TIMESTAMP NULL COMMENT 'Last successful sync timestamp',
    last_error TEXT NULL COMMENT 'Last error message if any',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY idx_sheet_unique (sheet_id, sheet_name),
    UNIQUE KEY idx_table_name (mysql_table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Change Log Table (CDC - Change Data Capture)
-- Records changes made directly to MySQL for sync to Sheets
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_change_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(64) NOT NULL COMMENT 'Source table name',
    row_id INT NOT NULL COMMENT 'Primary key of changed row',
    operation ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
    changed_columns JSON COMMENT 'Array of changed column names',
    old_values JSON COMMENT 'Previous values before change',
    new_values JSON COMMENT 'New values after change',
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN DEFAULT FALSE COMMENT 'Whether this change has been synced to Sheets',
    processed_at TIMESTAMP NULL COMMENT 'When this change was synced',
    error_message TEXT NULL COMMENT 'Error if sync failed',
    
    INDEX idx_unprocessed (processed, changed_at),
    INDEX idx_table_row (table_name, row_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Sync Conflicts Table
-- Records conflicts for manual review
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sheet_id VARCHAR(255) NOT NULL,
    sheet_name VARCHAR(255) NOT NULL,
    conflict_row_number INT NOT NULL,
    column_name VARCHAR(64) NULL,
    sheet_value TEXT NULL,
    db_value TEXT NULL,
    sheet_timestamp TIMESTAMP NULL,
    db_timestamp TIMESTAMP NULL,
    resolution ENUM('SHEET_WINS', 'DB_WINS', 'MANUAL', 'PENDING') DEFAULT 'PENDING',
    resolved_at TIMESTAMP NULL,
    resolved_by VARCHAR(255) NULL COMMENT 'User who resolved the conflict',
    notes TEXT NULL COMMENT 'Resolution notes',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_pending (resolution, created_at),
    INDEX idx_sheet_row (sheet_id, sheet_name, conflict_row_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Sync Audit Log
-- Tracks all sync operations for debugging and compliance
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    operation_type ENUM('SHEET_TO_DB', 'DB_TO_SHEET', 'SCHEMA_CHANGE', 'CONFLICT_RESOLVED') NOT NULL,
    sheet_id VARCHAR(255) NULL,
    sheet_name VARCHAR(255) NULL,
    table_name VARCHAR(64) NULL,
    audit_row_number INT NULL,
    details JSON COMMENT 'Additional operation details',
    status ENUM('SUCCESS', 'FAILED', 'SKIPPED') NOT NULL,
    error_message TEXT NULL,
    duration_ms INT NULL COMMENT 'Operation duration in milliseconds',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_operation (operation_type, created_at),
    INDEX idx_sheet (sheet_id, sheet_name, created_at),
    INDEX idx_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Rate Limit Tracking
-- Tracks API calls for rate limiting (backup to Redis)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_rate_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    resource VARCHAR(64) NOT NULL COMMENT 'e.g., sheets_api_write',
    window_start TIMESTAMP NOT NULL,
    request_count INT DEFAULT 0,
    max_requests INT NOT NULL,
    
    UNIQUE KEY idx_resource_window (resource, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Cleanup: Remove old audit logs (keep 30 days)
-- This event runs daily to prevent table bloat
-- -----------------------------------------------------------------------------
SET GLOBAL event_scheduler = ON;

DELIMITER //

CREATE EVENT IF NOT EXISTS cleanup_old_audit_logs
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO
BEGIN
    DELETE FROM sync_audit_log 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
    
    DELETE FROM sync_change_log 
    WHERE processed = TRUE 
    AND processed_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
END//

DELIMITER ;

-- -----------------------------------------------------------------------------
-- Grant permissions to sync user
-- -----------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON sheets_sync.* TO 'sync_user'@'%';
FLUSH PRIVILEGES;
