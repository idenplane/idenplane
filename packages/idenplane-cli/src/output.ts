import chalk from 'chalk';

export function printResult(data: unknown, opts: { json?: boolean }): void {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data)) {
    printTable(data);
  } else if (typeof data === 'object' && data !== null) {
    printKeyValue(data as Record<string, unknown>);
  } else {
    console.log(data);
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
