import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage.js';

describe('MemoryStorage', () => {
  it('should store and retrieve a value', () => {
    const storage = new MemoryStorage();
    storage.set('token', 'abc123');
    expect(storage.get('token')).toBe('abc123');
  });

  it('should return null for missing keys', () => {
    const storage = new MemoryStorage();
    expect(storage.get('nonexistent')).toBeNull();
  });

  it('should remove a value', () => {
    const storage = new MemoryStorage();
    storage.set('token', 'abc123');
    storage.remove('token');
    expect(storage.get('token')).toBeNull();
  });

  it('should clear all values', () => {
    const storage = new MemoryStorage();
    storage.set('token', 'abc123');
    storage.set('refresh', 'xyz789');
    storage.clear();
    expect(storage.get('token')).toBeNull();
    expect(storage.get('refresh')).toBeNull();
  });

  it('should overwrite existing values', () => {
    const storage = new MemoryStorage();
    storage.set('token', 'old');
    storage.set('token', 'new');
    expect(storage.get('token')).toBe('new');
  });

  it('should use the authme_ prefix internally', () => {
    const storage = new MemoryStorage();
    storage.set('token', 'abc');
    // Trying to get without prefix should return null
    expect(storage.get('authme_token')).toBeNull();
    // The intended key works
    expect(storage.get('token')).toBe('abc');
  });
});
