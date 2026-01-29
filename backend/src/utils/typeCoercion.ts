import { ColumnDataType } from '../types';

export function inferColumnType(value: unknown): ColumnDataType {
  if (value === null || value === undefined || value === '') return 'TEXT';

  if (typeof value === 'number') return 'NUMBER';

  const asString = String(value).trim();
  if (asString.length === 0) return 'TEXT';

  const lower = asString.toLowerCase();
  if (['true', 'false', 'yes', 'no', '1', '0'].includes(lower)) return 'BOOLEAN';

  const numeric = parseFloat(asString.replace(/[^0-9.-]/g, ''));
  if (!Number.isNaN(numeric) && /^-?[0-9]+(\.[0-9]+)?$/.test(asString.replace(/,/g, ''))) return 'NUMBER';

  const date = new Date(asString);
  if (!Number.isNaN(date.getTime()) && /\d{4}-\d{2}-\d{2}/.test(asString)) return 'DATE';

  return 'TEXT';
}

export function coerceValue(value: unknown, targetType: ColumnDataType): unknown {
  if (value === null || value === undefined || value === '') return null;

  try {
    switch (targetType) {
      case 'NUMBER': {
        const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
        return Number.isNaN(num) ? 0 : num;
      }
      case 'DATE': {
        const date = value instanceof Date ? value : new Date(String(value));
        return Number.isNaN(date.getTime()) ? null : date;
      }
      case 'BOOLEAN': {
        const lower = String(value).trim().toLowerCase();
        return ['true', '1', 'yes'].includes(lower) ? 1 : 0;
      }
      case 'TEXT':
      default:
        return String(value).trim();
    }
  } catch {
    return null;
  }
}

export function mysqlColumnType(columnType: ColumnDataType): string {
  switch (columnType) {
    case 'NUMBER':
      return 'DECIMAL(20,6) NULL';
    case 'DATE':
      return 'DATETIME NULL';
    case 'BOOLEAN':
      return 'TINYINT(1) NULL';
    case 'TEXT':
    default:
      return 'TEXT NULL';
  }
}
