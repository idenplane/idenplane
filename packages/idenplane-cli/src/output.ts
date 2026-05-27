import chalk from 'chalk';

// Stored auth credentials (persisted in the user's config file) — never useful
// to echo back and a leak risk via shell history / CI logs. They are replaced
// with a constant so the printed value carries no bytes of the secret (CodeQL
// js/clear-text-logging). Response-payload secrets such as `clientSecret` from
// `client rotate-secret` are intentionally NOT redacted — the user ran the
// command specifically to retrieve that value.
const STORED_CREDENTIAL_KEYS = new Set(['apiKey', 'accessToken']);
const REDACTED = '<redacted — see ~/.idenplane/config>';

function redactCredentials<T>(data: T): T {
  if (Array.isArray(data)) {
    return data.map((item) => redactCredentials(item)) as T;
  }
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      out[key] =
        STORED_CREDENTIAL_KEYS.has(key) && typeof val === 'string'
          ? REDACTED
          : redactCredentials(val);
    }
    return out as T;
  }
  return data;
}

export function printResult(data: unknown, opts: { json?: boolean }): void {
  const safe = redactCredentials(data);

  if (opts.json) {
    console.log(JSON.stringify(safe, null, 2));
    return;
  }

  if (Array.isArray(safe)) {
    printTable(safe);
  } else if (typeof safe === 'object' && safe !== null) {
    printKeyValue(safe as Record<string, unknown>);
  } else {
    console.log(safe);
  }
}

function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log(chalk.dim('No results.'));
    return;
  }

  const keys = Object.keys(rows[0]).filter(
    (k) => !isComplexValue(rows[0][k]),
  );

  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)),
  );

  const header = keys.map((k, i) => k.toUpperCase().padEnd(widths[i])).join('  ');
  console.log(chalk.bold(header));
  console.log(chalk.dim('-'.repeat(header.length)));

  for (const row of rows) {
    const line = keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  ');
    console.log(line);
  }
}

function printKeyValue(obj: Record<string, unknown>): void {
  const maxKey = Math.max(...Object.keys(obj).map((k) => k.length));
  for (const [key, val] of Object.entries(obj)) {
    const display = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
    console.log(`${chalk.bold(key.padEnd(maxKey))}  ${display}`);
  }
}

function isComplexValue(val: unknown): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function success(msg: string): void {
  console.log(chalk.green('OK') + ' ' + msg);
}

export function warn(msg: string): void {
  console.log(chalk.yellow('WARN') + ' ' + msg);
}
