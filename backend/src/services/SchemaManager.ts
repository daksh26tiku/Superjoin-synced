import { db } from '../config/database';
import { logger } from '../utils/logger';
import { ColumnDataType, SchemaColumn } from '../types';
import {
  defaultColumnHeader,
  defaultMysqlColumnName,
  sanitizeIdentifier,
  sanitizeTableName,
} from '../utils/columnUtils';
import { mysqlColumnType } from '../utils/typeCoercion';

export class SchemaManager {
  async ensureSheetRegistration(sheetId: string, sheetName: string): Promise<{ tableName: string }> {
    const tableName = sanitizeTableName(sheetId, sheetName);

    try {
      await db.execute(
        `INSERT INTO sync_sheets (sheet_id, sheet_name, mysql_table_name, sync_enabled)
         VALUES (:sheetId, :sheetName, :tableName, TRUE)
         ON DUPLICATE KEY UPDATE mysql_table_name = VALUES(mysql_table_name)`,
        { sheetId, sheetName, tableName }
      );

      await this.ensureBaseTable(tableName);

      return { tableName };
    } catch (error) {
      logger.error('Failed to ensure sheet registration', { sheetId, sheetName, error });
      throw error;
    }
  }

  async ensureColumnMapping(
    sheetId: string,
    sheetName: string,
    columnIndex: number,
    dataType: ColumnDataType
  ): Promise<SchemaColumn> {
    try {
      const existing = await db.query<SchemaColumn[]>(
        `SELECT 
           id as id,
           sheet_id as sheetId,
           sheet_name as sheetName,
           column_index as columnIndex,
           column_header as columnHeader,
           mysql_column_name as mysqlColumnName,
           data_type as dataType,
           created_at as createdAt,
           updated_at as updatedAt,
           is_deprecated as isDeprecated
         FROM sync_schema_registry
         WHERE sheet_id = :sheetId AND sheet_name = :sheetName AND column_index = :columnIndex
         LIMIT 1`,
        { sheetId, sheetName, columnIndex }
      );

      if (existing.length > 0) {
        const row = existing[0];
        if (row.dataType !== dataType && row.dataType === 'TEXT') {
          await db.execute(
            `UPDATE sync_schema_registry SET data_type = :dataType WHERE id = :id`,
            { id: row.id, dataType }
          );
          return { ...row, dataType };
        }
        return row;
      }

      const columnHeader = defaultColumnHeader(columnIndex);
      const mysqlColumnName = sanitizeIdentifier(defaultMysqlColumnName(columnIndex));

      await db.execute(
        `INSERT INTO sync_schema_registry (
           sheet_id, sheet_name, column_index, column_header, mysql_column_name, data_type
         ) VALUES (
           :sheetId, :sheetName, :columnIndex, :columnHeader, :mysqlColumnName, :dataType
         )`,
        { sheetId, sheetName, columnIndex, columnHeader, mysqlColumnName, dataType }
      );

      const inserted = await db.query<SchemaColumn[]>(
        `SELECT 
           id as id,
           sheet_id as sheetId,
           sheet_name as sheetName,
           column_index as columnIndex,
           column_header as columnHeader,
           mysql_column_name as mysqlColumnName,
           data_type as dataType,
           created_at as createdAt,
           updated_at as updatedAt,
           is_deprecated as isDeprecated
         FROM sync_schema_registry
         WHERE sheet_id = :sheetId AND sheet_name = :sheetName AND column_index = :columnIndex
         LIMIT 1`,
        { sheetId, sheetName, columnIndex }
      );

      if (inserted.length === 0) {
        throw new Error('Failed to read inserted schema registry row');
      }

      return inserted[0];
    } catch (error) {
      logger.error('Failed to ensure column mapping', { sheetId, sheetName, columnIndex, error });
      throw error;
    }
  }

  async ensureColumnExistsOnTable(tableName: string, mysqlColumnName: string, dataType: ColumnDataType): Promise<void> {
    try {
      const cols = await db.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) as cnt
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName AND COLUMN_NAME = :columnName`,
        { tableName, columnName: mysqlColumnName }
      );

      if ((cols[0]?.cnt ?? 0) > 0) return;

      const ddl = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${mysqlColumnName}\` ${mysqlColumnType(dataType)}`;
      await db.executeDynamicSQL(ddl);

      logger.info('Added new column to table', { tableName, mysqlColumnName, dataType });
    } catch (error) {
      logger.error('Failed to ensure column exists on table', { tableName, mysqlColumnName, error });
      throw error;
    }
  }

  private async ensureBaseTable(tableName: string): Promise<void> {
    const ddl = `
      CREATE TABLE IF NOT EXISTS \`${tableName}\` (
        _sync_row_id INT AUTO_INCREMENT PRIMARY KEY,
        _sheet_row_number INT NOT NULL,
        _row_hash VARCHAR(64) NULL,
        _last_modified_at DATETIME NOT NULL,
        _last_modified_by ENUM('SHEET','DATABASE','SYSTEM') NOT NULL,
        _sync_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        _synced_at DATETIME NULL,
        UNIQUE KEY uniq_sheet_row (_sheet_row_number),
        INDEX idx_last_modified (_last_modified_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await db.executeDynamicSQL(ddl);
  }
}

export const schemaManager = new SchemaManager();
