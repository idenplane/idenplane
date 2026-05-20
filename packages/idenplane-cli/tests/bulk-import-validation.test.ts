import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';
import type { BulkUserInput } from '../src/types.js';

/**
 * Extract the validation logic from user.ts into a standalone function for testing.
 * The bulk-import command validates: username required, email must be string if present.
 */
function validateUsers(users: unknown[]): {
  valid: Array<{ user: BulkUserInput; row: number }>;
  errors: Array<{ row: number; username?: string; error: string }>;
} {
  const valid: Array<{ user: BulkUserInput; row: number }> = [];
  const errors: Array<{ row: number; username?: string; error: string }> = [];

  for (let i = 0; i < users.length; i++) {
    const u = users[i] as Record<string, unknown>;
    const rowNum = i + 1;

    if (!u.username || typeof u.username !== 'string' || (u.username as string).trim() === '') {
      errors.push({ row: rowNum, error: 'Missing or empty "username" field' });
      continue;
    }

    if (u.email !== undefined && typeof u.email !== 'string') {
      errors.push({ row: rowNum, username: u.username as string, error: 'Invalid "email" field' });
      continue;
    }

    valid.push({ user: u as unknown as BulkUserInput, row: rowNum });
  }

  return { valid, errors };
}

test('validateUsers: accepts valid users', () => {
  const users = [
    { username: 'alice', email: 'alice@example.com' },
    { username: 'bob' },
  ];
  const { valid, errors } = validateUsers(users);
  assert.equal(valid.length, 2);
  assert.equal(errors.length, 0);
});

test('validateUsers: rejects user missing username', () => {
  const users = [{ email: 'alice@example.com' }];
  const { valid, errors } = validateUsers(users);
  assert.equal(valid.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].error.includes('username'));
});

test('validateUsers: rejects user with empty username', () => {
  const users = [{ username: '   ' }];
  const { valid, errors } = validateUsers(users);
  assert.equal(valid.length, 0);
  assert.equal(errors.length, 1);
});

test('validateUsers: rejects user with non-string email', () => {
  const users = [{ username: 'alice', email: 123 }];
  const { valid, errors } = validateUsers(users);
  assert.equal(valid.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].username, 'alice');
  assert.ok(errors[0].error.includes('email'));
});

test('validateUsers: mixed valid and invalid', () => {
  const users = [
    { username: 'alice' },
    { email: 'nousername@example.com' },
    { username: 'bob', email: 'bob@example.com' },
  ];
  const { valid, errors } = validateUsers(users);
  assert.equal(valid.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 2);
});

test('parseCsv + validateUsers: end-to-end from CSV', () => {
  const csv = `username,email,firstName
alice,alice@example.com,Alice
,missing@example.com,NoName
bob,bob@example.com,Bob`;

  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);

  const { valid, errors } = validateUsers(rows);
  assert.equal(valid.length, 2);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].error.includes('username'));
});
