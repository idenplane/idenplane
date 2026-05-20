/**
 * Minimal CSV parser that handles quoted fields.
 * Returns an array of objects keyed by the header row.
 */
export function parseCsv(raw: string): Record<string, string>[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (fields[j] ?? '').trim();
    }
    rows.push(obj);
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current);
  return fields;
}
