import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface ConfigCompatibilityIssue {
  type: 'error' | 'warning';
  path: string;
  message: string;
  currentValue?: string;
  requiredValue?: string;
}

export interface ConfigCompatibilityResult {
  compatible: boolean;
  version: string;
  issues: ConfigCompatibilityIssue[];
  summary: {
    errors: number;
    warnings: number;
  };
}

export interface VersionSchema {
  version: string;
  minConfigVersion: string;
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  deprecatedEnvVars: string[];
  removedFeatures: string[];
  breakingChanges: string[];
}

// Schema definitions for supported versions
const VERSION_SCHEMAS: Record<string, VersionSchema> = {
  '2.5.0': {
    version: '2.5.0',
    minConfigVersion: '2.0.0',
    requiredEnvVars: ['DATABASE_URL'],
    optionalEnvVars: [
      'REDIS_URL',
      'JWT_SECRET',
      'SMTP_HOST',
      'LOG_LEVEL',
      'BACKUP_DIR',
      'PGHOST',
      'PGPORT',
      'PGUSER',
    ],
    deprecatedEnvVars: ['AUTH_VERSION', 'LEGACY_AUTH'],
    removedFeatures: ['v1-auth-endpoints', 'legacy-sessions'],
    breakingChanges: [
      'JWT tokens now require RS256 algorithm',
      'Session cookies renamed from session to idenplane_session',
    ],
  },
  '2.4.0': {
    version: '2.4.0',
    minConfigVersion: '2.0.0',
    requiredEnvVars: ['DATABASE_URL'],
    optionalEnvVars: [
      'REDIS_URL',
      'JWT_SECRET',
      'SMTP_HOST',
      'LOG_LEVEL',
      'BACKUP_DIR',
      'PGHOST',
      'PGPORT',
      'PGUSER',
    ],
    deprecatedEnvVars: ['AUTH_VERSION'],
    removedFeatures: [],
    breakingChanges: [],
  },
  '2.3.0': {
    version: '2.3.0',
    minConfigVersion: '2.0.0',
    requiredEnvVars: ['DATABASE_URL'],
    optionalEnvVars: [
      'REDIS_URL',
      'JWT_SECRET',
      'SMTP_HOST',
      'LOG_LEVEL',
      'BACKUP_DIR',
    ],
    deprecatedEnvVars: [],
    removedFeatures: [],
    breakingChanges: [],
  },
};

/**
 * ConfigCompatibilityService
 *
 * Validates configuration compatibility before and after version upgrades.
 * Checks environment variables, feature flags, and configuration schemas
 * to ensure a safe upgrade path.
 */
@Injectable()
export class ConfigCompatibilityService {
  private readonly logger = new Logger(ConfigCompatibilityService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Check configuration compatibility for a target version.
   *
   * @param targetVersion The version to upgrade to
   * @returns Compatibility result with any issues found
   */
  async checkCompatibility(
    targetVersion: string,
  ): Promise<ConfigCompatibilityResult> {
    this.logger.log(
      `Checking configuration compatibility for version ${targetVersion}`,
    );

    const issues: ConfigCompatibilityIssue[] = [];

    // Get schema for target version (or use latest schema as fallback)
    const schema = VERSION_SCHEMAS[targetVersion] ?? this.getLatestSchema();

    // 1. Check required environment variables
    const requiredIssues = this.checkRequiredEnvVars(schema);
    issues.push(...requiredIssues);

    // 2. Check for deprecated environment variables
    const deprecatedIssues = this.checkDeprecatedEnvVars(schema);
    issues.push(...deprecatedIssues);

    // 3. Check for removed features in configuration
    const featureIssues = await this.checkRemovedFeatures(schema);
    issues.push(...featureIssues);

    // 4. Check database configuration compatibility
    const dbIssues = await this.checkDatabaseCompatibility(targetVersion);
    issues.push(...dbIssues);

    const errors = issues.filter((i) => i.type === 'error').length;
    const warnings = issues.filter((i) => i.type === 'warning').length;
    const compatible = errors === 0;

    this.logger.log(
      `Configuration compatibility check complete for ${targetVersion}: ` +
        `${compatible ? 'COMPATIBLE' : 'INCOMPATIBLE'} (${errors} errors, ${warnings} warnings)`,
    );

    return {
      compatible,
      version: targetVersion,
      issues,
      summary: { errors, warnings },
    };
  }

  /**
   * Check that all required environment variables are present.
   */
  private checkRequiredEnvVars(
    schema: VersionSchema,
  ): ConfigCompatibilityIssue[] {
    const issues: ConfigCompatibilityIssue[] = [];

    for (const varName of schema.requiredEnvVars) {
      if (!process.env[varName]) {
        issues.push({
          type: 'error',
          path: `env.${varName}`,
          message: `Required environment variable is not set`,
          requiredValue: varName,
        });
      }
    }

    return issues;
  }

  /**
   * Check for deprecated environment variables that may cause issues.
   */
  private checkDeprecatedEnvVars(
    schema: VersionSchema,
  ): ConfigCompatibilityIssue[] {
    const issues: ConfigCompatibilityIssue[] = [];

    for (const varName of schema.deprecatedEnvVars) {
      if (process.env[varName]) {
        issues.push({
          type: 'warning',
          path: `env.${varName}`,
          message: `This environment variable is deprecated and will be removed`,
          currentValue: varName,
          requiredValue: schema.version,
        });
      }
    }

    return issues;
  }

  /**
   * Check for configuration that references removed features.
   */
  private async checkRemovedFeatures(
    schema: VersionSchema,
  ): Promise<ConfigCompatibilityIssue[]> {
    const issues: ConfigCompatibilityIssue[] = [];

    if (schema.removedFeatures.length === 0) {
      return issues;
    }

    try {
      // Check realm configuration for removed feature references
      const realms = await this.prisma.realm.findMany({
        select: {
          id: true,
          name: true,
          theme: true,
        },
      });

      for (const realm of realms) {
        if (realm.theme) {
          const themeBlob = JSON.stringify(realm.theme);
          for (const feature of schema.removedFeatures) {
            if (themeBlob.includes(feature)) {
              issues.push({
                type: 'error',
                path: `realm.${realm.name}.theme`,
                message: `Configuration references removed feature: ${feature}`,
                currentValue: feature,
              });
            }
          }
        }
      }
    } catch (err) {
      this.logger.warn('Unable to check removed features in database', err);
    }

    return issues;
  }

  /**
   * Check database configuration compatibility.
   */
  private async checkDatabaseCompatibility(
    targetVersion: string,
  ): Promise<ConfigCompatibilityIssue[]> {
    const issues: ConfigCompatibilityIssue[] = [];

    try {
      // Check database version compatibility
      const result = await this.prisma.$queryRaw<Array<{ version: string }>>`
        SELECT version()
      `;

      if (result.length > 0) {
        const dbVersion = result[0].version;
        const isCompatible = this.isDatabaseVersionCompatible(
          dbVersion,
          targetVersion,
        );

        if (!isCompatible) {
          issues.push({
            type: 'error',
            path: 'database.version',
            message: `Database version may not be compatible with ${targetVersion}`,
            currentValue: dbVersion,
          });
        }
      }

      // Check for required extensions
      const extensions = await this.prisma.$queryRaw<
        Array<{ extname: string }>
      >`
        SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto')
      `;

      const requiredExtensions = ['uuid-ossp'];
      for (const ext of requiredExtensions) {
        if (!extensions.some((e) => e.extname === ext)) {
          issues.push({
            type: 'warning',
            path: `database.extension.${ext}`,
            message: `Required database extension is not installed`,
            requiredValue: ext,
          });
        }
      }
    } catch (err) {
      this.logger.warn('Unable to check database compatibility', err);
    }

    return issues;
  }

  /**
   * Check if database version is compatible with target version.
   */
  private isDatabaseVersionCompatible(
    dbVersion: string,
    targetVersion: string,
  ): boolean {
    // Parse database version string
    const pgMatch = dbVersion.match(/PostgreSQL (\d+)\.(\d+)/);
    if (!pgMatch) {
      return true; // Assume compatible if we can't parse
    }

    const majorVersion = parseInt(pgMatch[1], 10);
    const minorVersion = parseInt(pgMatch[2], 10);

    // Require PostgreSQL 12+ for latest versions
    if (targetVersion >= '2.5.0') {
      return majorVersion >= 13 || (majorVersion === 12 && minorVersion >= 1);
    }

    // Require PostgreSQL 11+ for earlier versions
    return majorVersion >= 11;
  }

  /**
   * Get the latest version schema definition.
   */
  private getLatestSchema(): VersionSchema {
    const versions = Object.keys(VERSION_SCHEMAS).sort((a, b) => {
      const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
      const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
      return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
    });

    return (
      VERSION_SCHEMAS[versions[0]] ?? {
        version: 'unknown',
        minConfigVersion: '2.0.0',
        requiredEnvVars: ['DATABASE_URL'],
        optionalEnvVars: [],
        deprecatedEnvVars: [],
        removedFeatures: [],
        breakingChanges: [],
      }
    );
  }

  /**
   * Get list of breaking changes for a target version.
   *
   * @param targetVersion The version to check
   * @returns List of breaking change descriptions
   */
  getBreakingChanges(targetVersion: string): string[] {
    const schema = VERSION_SCHEMAS[targetVersion];
    return schema?.breakingChanges ?? [];
  }

  /**
   * Get list of deprecated environment variables for a target version.
   *
   * @param targetVersion The version to check
   * @returns List of deprecated variable names
   */
  getDeprecatedEnvVars(targetVersion: string): string[] {
    const schema = VERSION_SCHEMAS[targetVersion];
    return schema?.deprecatedEnvVars ?? [];
  }

  /**
   * Validate a specific configuration value against expected schema.
   *
   * @param path Dot-notation path to the config value
   * @param value The value to validate
   * @param rules Validation rules
   * @returns null if valid, error message if invalid
   */
  validateConfigValue(
    path: string,
    value: unknown,
    rules: {
      required?: boolean;
      type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
      pattern?: RegExp;
      minLength?: number;
      maxLength?: number;
      min?: number;
      max?: number;
    },
  ): ConfigCompatibilityIssue | null {
    // Check required
    if (
      rules.required &&
      (value === undefined || value === null || value === '')
    ) {
      return {
        type: 'error',
        path,
        message: 'Configuration value is required',
      };
    }

    // Skip validation if value is not set and not required
    if (value === undefined || value === null || value === '') {
      return null;
    }

    // Check type
    if (rules.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rules.type) {
        return {
          type: 'error',
          path,
          message: `Expected type ${rules.type} but got ${actualType}`,
          currentValue:
            value != null ? (JSON.stringify(value) ?? undefined) : undefined,
        };
      }
    }

    // Check pattern
    if (
      rules.pattern &&
      typeof value === 'string' &&
      !rules.pattern.test(value)
    ) {
      return {
        type: 'error',
        path,
        message: `Value does not match required pattern`,
        currentValue: value,
      };
    }

    // Check string length
    if (typeof value === 'string') {
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        return {
          type: 'error',
          path,
          message: `Value must be at least ${rules.minLength} characters`,
          currentValue: value,
        };
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        return {
          type: 'error',
          path,
          message: `Value must be at most ${rules.maxLength} characters`,
          currentValue: value,
        };
      }
    }

    // Check numeric range
    if (typeof value === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        return {
          type: 'error',
          path,
          message: `Value must be at least ${rules.min}`,
          currentValue: String(value),
        };
      }
      if (rules.max !== undefined && value > rules.max) {
        return {
          type: 'error',
          path,
          message: `Value must be at most ${rules.max}`,
          currentValue: String(value),
        };
      }
    }

    return null;
  }

  /**
   * Clean up Prisma client connections.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
