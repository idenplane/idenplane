import type { TokenStorage } from './storage.js';

interface ClientIdentity { url: string; realm: string; clientId: string; redirectUri: string }
interface Transaction { state: string; verifier: string; createdAt: number }
const MAX_AGE_MS = 10 * 60 * 1000;

function transactionKey(config: ClientIdentity): string {
  return 'idenplane.login.' + encodeURIComponent(JSON.stringify([config.url, config.realm, config.clientId, config.redirectUri]));
}

function browserStore(): Storage | undefined {
  // A denied browser storage getter must throw: never redirect with state that
  // cannot survive navigation. Access/refresh/ID tokens are not written here.
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

export function saveLoginTransaction(config: ClientIdentity, fallback: TokenStorage, state: string, verifier: string): void {
  const value = JSON.stringify({ state, verifier, createdAt: Date.now() });
  const store = browserStore();
  if (store) store.setItem(transactionKey(config), value);
  else fallback.set(transactionKey(config), value);
}

export function readLoginTransaction(config: ClientIdentity, fallback: TokenStorage): Transaction | null {
  const store = browserStore();
  const value = store ? store.getItem(transactionKey(config)) : fallback.get(transactionKey(config));
  if (!value) {
    // Preserve explicit non-browser callback integrations using TokenStorage.
    if (!store) {
      const state = fallback.get('auth_state'), verifier = fallback.get('pkce_verifier');
      if (state && verifier) return { state, verifier, createdAt: Date.now() };
    }
    return null;
  }
  try {
    const transaction: Transaction = JSON.parse(value);
    const age = Date.now() - transaction.createdAt;
    if (typeof transaction.state !== 'string' || !transaction.state || typeof transaction.verifier !== 'string' || !transaction.verifier || !Number.isFinite(transaction.createdAt) || age < 0 || age > MAX_AGE_MS) return null;
    return transaction;
  } catch { return null; }
}

export function clearLoginTransaction(config: ClientIdentity, fallback: TokenStorage): void {
  const store = browserStore();
  if (store) store.removeItem(transactionKey(config));
  else fallback.remove(transactionKey(config));
  fallback.remove('pkce_verifier');
  fallback.remove('auth_state');
}
