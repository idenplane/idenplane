import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('parseCsv: returns empty array for empty input', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('\n'), []);
});

test('parseCsv: returns empty array when only header is present', () => {
  assert.deepEqual(parseCsv('username,email'), []);
});

test('parseCsv: parses basic rows', () => {
  const csv = `username,email,firstName,lastName
alice,alice@example.com,Alice,Smith
bob,bob@example.com,Bob,Jones`;

  const result = parseCsv(csv);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    username: 'alice',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
  });
  assert.deepEqual(result[1], {
    username: 'bob',
    email: 'bob@example.com',
    firstName: 'Bob',
    lastName: 'Jones',
  });
});

test('parseCsv: handles quoted fields with commas', () => {
  const csv = `username,email
"user,one",user@example.com`;

  const result = parseCsv(csv);
  assert.equal(result.length, 1);
  assert.equal(result[0].username, 'user,one');
  assert.equal(result[0].email, 'user@example.com');
});

test('parseCsv: handles escaped double quotes', () => {
  const csv = `username,firstName
alice,"Alice ""The Great"" Smith"`;

  const result = parseCsv(csv);
  assert.equal(result.length, 1);
  assert.equal(result[0].firstName, 'Alice "The Great" Smith');
});

test('parseCsv: trims whitespace from headers and values', () => {
  const csv = ` username , email \nalice , alice@example.com `;
  const result = parseCsv(csv);
  assert.equal(result.length, 1);
  assert.equal(result[0].username, 'alice');
  assert.equal(result[0].email, 'alice@example.com');
});

test('parseCsv: handles missing trailing fields', () => {
  const csv = `username,email,firstName
alice,alice@example.com`;

  const result = parseCsv(csv);
  assert.equal(result.length, 1);
  assert.equal(result[0].username, 'alice');
  assert.equal(result[0].email, 'alice@example.com');
  assert.equal(result[0].firstName, '');
});

test('parseCsv: handles CRLF line endings', () => {
  const csv = `username,email\r\nalice,alice@example.com\r\nbob,bob@example.com`;
  const result = parseCsv(csv);
  assert.equal(result.length, 2);
  assert.equal(result[0].username, 'alice');
  assert.equal(result[1].username, 'bob');
});
