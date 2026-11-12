import { SessionCipher, newSessionId, sessionHash, validSessionId } from './crypto.ts';

interface QueryResult { rows: Record<string, unknown>[]; rowCount: number | null }
interface SqlClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(error?: Error): void;
}
export interface SessionPool {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<SqlClient>;
}

// The driver is injected so storage can be tested separately from HTTP/OIDC.
// No process-local map participates in authorization or refresh locking.
export class PostgresSessionStore {
  private readonly pool: SessionPool;
  private readonly cipher: SessionCipher;
  constructor(pool: SessionPool, cipher: SessionCipher) { this.pool = pool; this.cipher = cipher; }

  async createLogin(data: unknown, state: string, lifetimeSeconds = 600): Promise<string> {
    if (!state || !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 600) throw new Error('Invalid login transaction lifetime');
    const id = newSessionId(), hash = sessionHash(id);
    await this.pool.query(`INSERT INTO bff_sessions (sid_hash, kind, state_hash, payload, expires_at, idle_seconds)
      VALUES ($1, 'login', $2, $3, clock_timestamp() + $4 * interval '1 second', $4)`,
      [hash, sessionHash(state), this.cipher.seal(data, 'login:'+hash), lifetimeSeconds]);
    return id;
  }

  async consumeLogin<T>(id: string, state: string): Promise<T | null> {
    if (!validSessionId(id) || !state) return null;
    const hash = sessionHash(id);
    const result = await this.pool.query(`DELETE FROM bff_sessions WHERE sid_hash=$1 AND kind='login'
      AND state_hash=$2 AND expires_at > clock_timestamp() RETURNING payload`, [hash, sessionHash(state)]);
    return result.rows[0] ? this.cipher.open<T>(String(result.rows[0].payload), 'login:'+hash) : null;
  }

  async createSession(data: unknown, lifetimeSeconds = 28800, idleSeconds = 1800): Promise<string> {
    if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 86400 || !Number.isInteger(idleSeconds) || idleSeconds < 1 || idleSeconds > lifetimeSeconds) throw new Error('Invalid session lifetime');
    const id = newSessionId(), hash = sessionHash(id);
    await this.pool.query(`INSERT INTO bff_sessions (sid_hash, kind, payload, expires_at, idle_seconds)
      VALUES ($1, 'session', $2, clock_timestamp() + $3 * interval '1 second', $4)`,
      [hash, this.cipher.seal(data, 'session:'+hash), lifetimeSeconds, idleSeconds]);
    return id;
  }

  // A row lock serializes refresh and revocation across all workers. After a
  // successful revoke response, a copied cookie cannot authorize a new request.
  async withSession<T, R>(id: string, work: (data: T) => Promise<{ value: R; data?: T }>): Promise<R | null> {
    if (!validSessionId(id)) return null;
    const hash = sessionHash(id), client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result = await client.query(`SELECT payload FROM bff_sessions WHERE sid_hash=$1 AND kind='session'
        AND expires_at > clock_timestamp() AND last_seen_at + idle_seconds * interval '1 second' > clock_timestamp() FOR UPDATE`, [hash]);
      if (!result.rows[0]) { await client.query('COMMIT');return null; }
      const data = this.cipher.open<T>(String(result.rows[0].payload), 'session:'+hash);
      const next = await work(data);
      const updated = await client.query(`UPDATE bff_sessions SET payload=COALESCE($2, payload), last_seen_at=clock_timestamp()
        WHERE sid_hash=$1 AND expires_at > clock_timestamp()
        AND last_seen_at + idle_seconds * interval '1 second' > clock_timestamp()`,
        [hash, next.data === undefined ? null : this.cipher.seal(next.data, 'session:'+hash)]);
      await client.query('COMMIT');
      return updated.rowCount === 1 ? next.value : null;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { releaseError = new Error('Session transaction rollback failed'); }
      throw error;
    } finally { client.release(releaseError); }
  }

  async revokeSession<T>(id: string): Promise<T | null> {
    if (!validSessionId(id)) return null;
    const hash = sessionHash(id);
    const result = await this.pool.query("DELETE FROM bff_sessions WHERE sid_hash=$1 AND kind='session' RETURNING payload", [hash]);
    return result.rows[0] ? this.cipher.open<T>(String(result.rows[0].payload), 'session:'+hash) : null;
  }

  async deleteExpired(): Promise<void> {
    await this.pool.query(`DELETE FROM bff_sessions WHERE expires_at <= clock_timestamp()
      OR last_seen_at + idle_seconds * interval '1 second' <= clock_timestamp()`);
  }
}
