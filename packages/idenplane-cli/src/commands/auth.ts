import { Command } from 'commander';
import chalk from 'chalk';
import { saveConfig, clearConfig } from '../config.js';
import { ask, askPassword } from '../prompt.js';
import { printResult, success } from '../output.js';
import { HttpClient } from '../http.js';
import type { LoginResponse } from '../types.js';

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Authenticate with an AuthMe server')
    .option('--server <url>', 'Server URL')
    .option('--username <username>', 'Admin username')
    .option('--password <password>', 'Admin password')
    .option('--api-key <key>', 'Use static API key instead of username/password')
    .action(async (opts) => {
      const serverUrl = (opts.server || (await ask('Server URL: '))).replace(/\/$/, '');

      if (opts.apiKey) {
        // Save config temporarily to allow HttpClient to use the API key
        saveConfig({ serverUrl, accessToken: '', apiKey: opts.apiKey });
        try {
          const client = new HttpClient();
          await client.get('/admin/auth/me');
        } catch (err: unknown) {
          // Validation failed — clear the saved config
          clearConfig();
          throw err;
        }
        success(`Authenticated to ${serverUrl} via API key`);
        return;
      }

      const username = opts.username || (await ask('Username: '));
      const password = opts.password || (await askPassword('Password: '));

      const res = await fetch(`${serverUrl}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string };
        throw new Error(chalk.red(`Login failed: ${err.message}`));
      }

      const data = (await res.json()) as LoginResponse;
      saveConfig({ serverUrl, accessToken: data.access_token });
      success(`Logged in to ${serverUrl} as ${username}`);
    });

  program
    .command('logout')
    .description('Clear saved credentials')
    .action(() => {
      clearConfig();
      success('Logged out. Credentials cleared.');
    });

  program
    .command('whoami')
    .description('Show current authenticated user info')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = new HttpClient();
      const me = await client.get('/admin/auth/me');
      printResult(me, opts);
    });
}
