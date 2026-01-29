import crypto from 'crypto';

export function computeHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function computeRowHash(rowData: Record<string, unknown>): string {
  const normalized = JSON.stringify(rowData, Object.keys(rowData).sort());
  return computeHash(normalized);
}
