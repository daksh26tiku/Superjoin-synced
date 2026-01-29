export function sanitizeIdentifier(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const replaced = trimmed.replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_');
  const noEdgeUnderscores = replaced.replace(/^_+|_+$/g, '');
  const safe = noEdgeUnderscores.length === 0 ? 'col' : noEdgeUnderscores;
  const prefixed = /^[0-9]/.test(safe) ? `col_${safe}` : safe;
  return prefixed.substring(0, 64);
}

export function sanitizeTableName(sheetId: string, sheetName: string): string {
  const idPart = sanitizeIdentifier(sheetId).substring(0, 24);
  const namePart = sanitizeIdentifier(sheetName).substring(0, 24);
  const base = `sheet_${idPart}_${namePart}`;
  return base.substring(0, 64);
}

export function defaultColumnHeader(columnIndex: number): string {
  return `col_${columnIndex}`;
}

export function defaultMysqlColumnName(columnIndex: number): string {
  return `col_${columnIndex}`.substring(0, 64);
}
