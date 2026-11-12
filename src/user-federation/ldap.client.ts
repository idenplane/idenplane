import { isIP } from 'node:net';
import { Client as LdapClient } from 'ldapts';

export interface LdapConnectionConfig {
  connectionUrl: string;
  bindDn: string;
  bindCredential: string;
  startTls: boolean;
  connectionTimeout: number;
}

export interface LdapSearchConfig {
  usersDn: string;
  userObjectClass: string;
  usernameLdapAttr: string;
  uuidLdapAttr: string;
  searchFilter?: string;
}

export interface LdapUserEntry {
  dn: string;
  uid: string;
  uuid: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
}

export class LdapClientWrapper {
  private config: LdapConnectionConfig;
  private searchConfig: LdapSearchConfig;

  constructor(config: LdapConnectionConfig, searchConfig: LdapSearchConfig) {
    this.config = config;
    this.searchConfig = searchConfig;
  }

  private createClient(): LdapClient {
    const protocol = new URL(this.config.connectionUrl).protocol;
    if (protocol !== 'ldap:' && protocol !== 'ldaps:') {
      throw new Error('LDAP URL must use ldap:// or ldaps://');
    }
    return new LdapClient({
      url: this.config.connectionUrl,
      timeout: this.config.connectionTimeout,
      connectTimeout: this.config.connectionTimeout,
      tlsOptions:
        protocol === 'ldaps:' ? { rejectUnauthorized: true } : undefined,
    });
  }

  private async withBoundClient<T>(
    dn: string,
    credential: string,
    work: (client: LdapClient) => Promise<T> | T,
  ): Promise<T> {
    const client = this.createClient();
    try {
      if (
        this.config.startTls &&
        new URL(this.config.connectionUrl).protocol === 'ldap:'
      ) {
        const hostname = new URL(this.config.connectionUrl).hostname.replace(
          /^\[|\]$/g,
          '',
        );
        await client.startTLS({
          rejectUnauthorized: true,
          host: hostname,
          servername: isIP(hostname) ? undefined : hostname,
        });
      }
      await client.bind(dn, credential);
      return await work(client);
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.withBoundClient(
        this.config.bindDn,
        this.config.bindCredential,
        () => undefined,
      );
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  async authenticate(username: string, password: string): Promise<boolean> {
    // LDAP servers can accept an empty password as an anonymous bind.
    if (!username || !password) return false;
    try {
      const userDn = await this.withBoundClient(
        this.config.bindDn,
        this.config.bindCredential,
        async (client) => {
          const result = await client.search(this.searchConfig.usersDn, {
            scope: 'sub',
            filter: this.buildUserFilter(username),
            sizeLimit: 1,
          });
          return result.searchEntries[0]?.dn;
        },
      );
      if (!userDn) return false;
      return await this.withBoundClient(userDn, password, () => true);
    } catch {
      return false;
    }
  }

  async searchUser(username: string): Promise<LdapUserEntry | null> {
    try {
      return await this.withBoundClient(
        this.config.bindDn,
        this.config.bindCredential,
        async (client) => {
          const result = await client.search(this.searchConfig.usersDn, {
            scope: 'sub',
            filter: this.buildUserFilter(username),
            sizeLimit: 1,
          });
          return result.searchEntries.length
            ? this.mapEntry(result.searchEntries[0])
            : null;
        },
      );
    } catch {
      return null;
    }
  }

  async searchAllUsers(): Promise<LdapUserEntry[]> {
    try {
      return await this.withBoundClient(
        this.config.bindDn,
        this.config.bindCredential,
        async (client) => {
          const filter = this.searchConfig.searchFilter
            ? `(&(objectClass=${this.searchConfig.userObjectClass})${this.searchConfig.searchFilter})`
            : `(objectClass=${this.searchConfig.userObjectClass})`;
          const result = await client.search(this.searchConfig.usersDn, {
            scope: 'sub',
            filter,
          });
          return result.searchEntries.map((entry) => this.mapEntry(entry));
        },
      );
    } catch {
      return [];
    }
  }

  private buildUserFilter(username: string): string {
    const base = `(&(objectClass=${this.searchConfig.userObjectClass})(${this.searchConfig.usernameLdapAttr}=${this.escapeLdap(username)}))`;
    if (this.searchConfig.searchFilter) {
      return `(&${base}${this.searchConfig.searchFilter})`;
    }
    return base;
  }

  private mapEntry(entry: Record<string, unknown>): LdapUserEntry {
    const str = (v: unknown) => {
      if (typeof v === 'string') return v;
      if (Array.isArray(v) && v.length > 0) return String(v[0]);
      if (v instanceof Buffer) return v.toString('utf-8');
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- intentional object stringification
      if (v) return String(v);
      return undefined;
    };

    return {
      dn: str(entry['dn']) ?? '',
      uid: str(entry[this.searchConfig.usernameLdapAttr]) ?? '',
      uuid: str(entry[this.searchConfig.uuidLdapAttr]) ?? '',
      email: str(entry['mail']),
      firstName: str(entry['givenName']),
      lastName: str(entry['sn']),
    };
  }

  private escapeLdap(s: string): string {
    return s.replace(
      /[\\*()\0/]/g,
      (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'),
    );
  }
}
