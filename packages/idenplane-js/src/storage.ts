export interface TokenStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
}

const PREFIX = 'authme_';

export class BrowserStorage implements TokenStorage {
  private store: Storage;

  constructor(type: 'sessionStorage' | 'localStorage') {
    this.store = type === 'localStorage' ? localStorage : sessionStorage;
  }

  get(key: string): string | null {
    return this.store.getItem(PREFIX + key);
  }

  set(key: string, value: string): void {
    this.store.setItem(PREFIX + key, value);
  }

  remove(key: string): void {
    this.store.removeItem(PREFIX + key);
  }

  clear(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < this.store.length; i++) {
      const key = this.store.key(i);
      if (key?.startsWith(PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.store.removeItem(key);
    }
  }
}

export class MemoryStorage implements TokenStorage {
  private store = new Map<string, string>();

  get(key: string): string | null {
    return this.store.get(PREFIX + key) ?? null;
  }

  set(key: string, value: string): void {
    this.store.set(PREFIX + key, value);
  }

  remove(key: string): void {
    this.store.delete(PREFIX + key);
  }

  clear(): void {
    this.store.clear();
  }
}

export function createStorage(type: 'sessionStorage' | 'localStorage' | 'memory'): TokenStorage {
  if (type === 'memory' || typeof window === 'undefined') {
    return new MemoryStorage();
  }
  return new BrowserStorage(type);
}
