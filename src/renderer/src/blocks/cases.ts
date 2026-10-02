// A "cases" parameter (Define Variable's Per condition): condition + value rows, stored as JSON.
export interface CaseRow {
  className: string;
  mode: 'if' | 'unless';
  value: string;
}

export function parseCases(text: string | undefined): CaseRow[] {
  try {
    const rows: unknown = JSON.parse(text || '[]');
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      .map(row => ({
        className: typeof row.className === 'string' ? row.className : '',
        mode: row.mode === 'unless' ? 'unless' : 'if',
        value: typeof row.value === 'string' ? row.value : ''
      }));
  } catch {
    return [];
  }
}

export const serializeCases = (rows: CaseRow[]): string => JSON.stringify(rows);

// For cards: "debian: www-data · redhat: nginx".
export function describeCases(text: string | undefined): string {
  return parseCases(text)
    .filter(row => row.className.trim())
    .map(row => `${row.mode === 'unless' ? 'not ' : ''}${row.className}: ${row.value}`)
    .join(' · ');
}
