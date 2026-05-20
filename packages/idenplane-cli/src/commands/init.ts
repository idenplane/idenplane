import { Command } from 'commander';
import chalk from 'chalk';
import { saveConfig } from '../config.js';
import { HttpClient } from '../http.js';
import { ask, askPassword, confirm, select } from '../prompt.js';
import { printResult, success } from '../output.js';
import type { LoginResponse } from '../types.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Interactive setup: connect, create realm, client, and roles')
    .action(async () => {
      console.log(chalk.bold('\n  AuthMe Setup Wizard\n'));

      // Step 1: Connect to server
      const serverUrl = (await ask('Server URL (e.g. http://localhost:3000): ')).replace(/\/$/, '');
      const authMethod = await select('Authentication method:', [
        'Username/Password',
        'API Key',
      ]);

      if (authMethod === 'API Key') {
        const apiKey = await ask('API Key: ');
        saveConfig({ serverUrl, accessToken: '', apiKey });
      } else {
        const username = await ask('Admin username: ');
        const password = await askPassword('Admin password: ');

        const res = await fetch(`${serverUrl}/admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (!res.ok) {
          throw new Error(chalk.red('Login failed. Check your credentials and server URL.'));
        }

        const data = (await res.json()) as LoginResponse;
        saveConfig({ serverUrl, accessToken: data.access_token });
      }
      success('Connected to server.');

      // Step 2: Create realm
      const createRealm = await confirm('Create a new realm?');
      let realmName = '';
      if (createRealm) {
        realmName = await ask('Realm name (lowercase slug): ');
        const displayName = (await ask(`Display name [${realmName}]: `)) || realmName;
        const http = new HttpClient();
        await http.post('/admin/realms', { name: realmName, displayName });
        success(`Realm "${realmName}" created.`);
      } else {
        realmName = await ask('Existing realm name: ');
      }

      // Step 3: Create client
      const createClient = await confirm('Create a client in this realm?');
      if (createClient) {
        const clientId = await ask('Client ID: ');
        const clientType = await select('Client type:', ['PUBLIC', 'CONFIDENTIAL']);
        const redirectUri = await ask('Redirect URI (e.g. http://localhost:5173/callback): ');
        const http = new HttpClient();
        const result = await http.post(`/admin/realms/${realmName}/clients`, {
          clientId,
          clientType,
          redirectUris: redirectUri ? [redirectUri] : [],
          grantTypes: ['authorization_code', 'refresh_token'],
        });
        printResult(result, { json: false });
      }

      // Step 4: Create default roles
      const createRoles = await confirm('Create default roles (admin, user)?');
      if (createRoles) {
        const http = new HttpClient();
        await http.post(`/admin/realms/${realmName}/roles`, {
          name: 'admin',
          description: 'Administrator role',
        });
        await http.post(`/admin/realms/${realmName}/roles`, {
          name: 'user',
          description: 'Default user role',
        });
        success('Roles "admin" and "user" created.');
      }

      console.log(chalk.bold.green('\n  Setup complete!\n'));
      console.log(`  Server:  ${serverUrl}`);
      console.log(`  Realm:   ${realmName}`);
      console.log(`  Config:  ~/.authme/config.json`);
      console.log();
    });
}
