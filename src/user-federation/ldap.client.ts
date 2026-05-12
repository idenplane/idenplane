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
    return new LdapClient({
      url: this.config.connectionUrl,
      timeout: this.config.connectionTimeout,
      connectTimeout: this.config.connectionTimeout,
      tlsOptions: this.config.startTls
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const client = this.createClient();
    try {
      await client.bind(this.config.bindDn, this.config.bindCredential);
      await client.unbind();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message ?? 'Connection failed' };
    }
  }

  async authenticate(username: string, password: string): Promise<boolean> {
    const client = this.createClient();
    try {
      // First bind as service account to find user DN
      await client.bind(this.config.bindDn, this.config.bindCredential);

      const filter = this.buildUserFilter(username);
      const result = await client.search(this.searchConfig.usersDn, {
        scope: 'sub',
        filter,
        sizeLimit: 1,
      });

      if (result.searchEntries.length === 0) {
        await client.unbind();
        return false;
      }

      const userDn = result.searchEntries[0]['dn'];
      await client.unbind();

      // Now try to bind as the user
      const userClient = this.createClient();
      try {
        await userClient.bind(userDn, password);
        await userClient.unbind();
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  async searchUser(username: string): Promise<LdapUserEntry | null> {
    const client = this.createClient();
    try {
      await client.bind(this.config.bindDn, this.config.bindCredential);

      const filter = this.buildUserFilter(username);
      const result = await client.search(this.searchConfig.usersDn, {
        scope: 'sub',
        filter,
        sizeLimit: 1,
      });

      await client.unbind();

      if (result.searchEntries.length === 0) return null;

      const entry = result.searchEntries[0];
      return this.mapEntry(entry);
    } catch {
      return null;
    }
  }

  async searchAllUsers(): Promise<LdapUserEntry[]> {
    const client = this.createClient();
    try {
      await client.bind(this.config.bindDn, this.config.bindCredential);

      const filter = this.searchConfig.searchFilter
        ? `(&(objectClass=${this.searchConfig.userObjectClass})${this.searchConfig.searchFilter})`
        : `(objectClass=${this.searchConfig.userObjectClass})`;

      const result = await client.search(this.searchConfig.usersDn, {
        scope: 'sub',
        filter,
      });

      await client.unbind();
      return result.searchEntries.map((e) => this.mapEntry(e));
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
      return v ? String(v) : undefined;
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
