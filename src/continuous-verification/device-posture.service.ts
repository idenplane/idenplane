import { Injectable, Logger } from '@nestjs/common';
import { Prisma as _Prisma } from '@prisma/client';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DevicePostureData,
  evaluateDevicePosture,
  ContinuousRiskSignal,
} from './continuous-risk-signals.js';

// ─── Public API types ─────────────────────────────────────────────────────────

export interface DeviceTrustTier {
  tier: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;
  factors: string[];
}

export interface DeviceComplianceResult {
  compliant: boolean;
  failures: DeviceComplianceFailure[];
  warnings: DeviceComplianceWarning[];
  deviceTrustTier: DeviceTrustTier;
}

export interface DeviceComplianceFailure {
  check: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

export interface DeviceComplianceWarning {
  check: string;
  reason: string;
}

export interface PosturePolicyConfig {
  requireEncryption: boolean;
  requireLockScreen: boolean;
  requireAntivirus: boolean;
  requireFirewall: boolean;
  requireMDM: boolean;
  maxDaysSinceSecurityScan: number;
  allowedOSTypes?: string[];
  blockedOSTypes?: string[];
  minOSVersion?: string;
}

export interface DevicePostureSummary {
  sessionId: string;
  deviceFingerprint: string;
  osType: string | null;
  osVersion: string | null;
  trustTier: string;
  complianceStatus: string;
  lastReportedAt: Date | null;
}

// ─── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class DevicePostureService {
  private readonly logger = new Logger(DevicePostureService.name);

  // Default posture policy configuration
  private readonly defaultPostureConfig: PosturePolicyConfig = {
    requireEncryption: true,
    requireLockScreen: true,
    requireAntivirus: false,
    requireFirewall: false,
    requireMDM: false,
    maxDaysSinceSecurityScan: 7,
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates device posture and returns compliance result with trust tier.
   */
  async evaluateDevicePosture(
    sessionId: string,
    realmId: string,
    config?: Partial<PosturePolicyConfig>,
  ): Promise<DeviceComplianceResult> {
    const postureConfig = { ...this.defaultPostureConfig, ...config };

    // Fetch latest posture record for this session
    const latestRecord = await this.prisma.devicePostureRecord.findFirst({
      where: { sessionId, realmId },
      orderBy: { reportedAt: 'desc' },
    });

    const postureData = this.buildDevicePostureData(latestRecord);

    // Evaluate device posture signals
    const signal = evaluateDevicePosture(
      postureData,
      postureConfig.requireMDM,
      {
        minDaysSinceScan: postureConfig.maxDaysSinceSecurityScan,
        requireEncryption: postureConfig.requireEncryption,
        requireLockScreen: postureConfig.requireLockScreen,
      },
    );

    // Determine compliance failures and warnings
    const failures = this.determineComplianceFailures(
      postureData,
      latestRecord,
      postureConfig,
      signal,
    );

    const warnings = this.determineComplianceWarnings(
      postureData,
      latestRecord,
      postureConfig,
    );

    // Calculate device trust tier
    const deviceTrustTier = this.calculateTrustTier(
      postureData,
      failures,
      signal.score,
    );

    // Update the posture record with computed trust tier
    if (latestRecord) {
      await this.prisma.devicePostureRecord.update({
        where: { id: latestRecord.id },
        data: {
          deviceTrustTier: deviceTrustTier.tier,
          complianceStatus:
            failures.length === 0 ? 'COMPLIANT' : 'NON_COMPLIANT',
        },
      });
    }

    const compliant =
      failures.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
        .length === 0;

    this.logger.debug(
      `Device posture evaluation sessionId=${sessionId} compliant=${compliant} tier=${deviceTrustTier.tier}`,
    );

    return {
      compliant,
      failures,
      warnings,
      deviceTrustTier,
    };
  }

  /**
   * Gets a summary of device posture for a session.
   */
  async getDevicePostureSummary(
    sessionId: string,
  ): Promise<DevicePostureSummary | null> {
    const latestRecord = await this.prisma.devicePostureRecord.findFirst({
      where: { sessionId },
      orderBy: { reportedAt: 'desc' },
    });

    if (!latestRecord) {
      return null;
    }

    return {
      sessionId,
      deviceFingerprint: latestRecord.deviceFingerprint,
      osType: latestRecord.osType,
      osVersion: latestRecord.osVersion,
      trustTier: latestRecord.deviceTrustTier,
      complianceStatus: latestRecord.complianceStatus ?? 'UNKNOWN',
      lastReportedAt: latestRecord.reportedAt,
    };
  }

  /**
   * Gets posture history for a device across sessions.
   */
  async getDevicePostureHistory(
    deviceFingerprint: string,
    realmId: string,
    limit = 10,
  ): Promise<DevicePostureSummary[]> {
    const records = await this.prisma.devicePostureRecord.findMany({
      where: { deviceFingerprint, realmId },
      orderBy: { reportedAt: 'desc' },
      take: limit,
    });

    return records.map((record) => ({
      sessionId: record.sessionId,
      deviceFingerprint: record.deviceFingerprint,
      osType: record.osType,
      osVersion: record.osVersion,
      trustTier: record.deviceTrustTier,
      complianceStatus: record.complianceStatus ?? 'UNKNOWN',
      lastReportedAt: record.reportedAt,
    }));
  }

  /**
   * Checks if a device is known and trusted for a user.
   */
  async isDeviceTrusted(
    realmId: string,
    userId: string,
    deviceFingerprint: string,
  ): Promise<boolean> {
    const knownDevices = await this.prisma.userLoginProfile.findUnique({
      where: { userId },
    });

    if (!knownDevices || !knownDevices.knownDevices) {
      return false;
    }

    const devices = knownDevices.knownDevices as Array<{
      fingerprint: string;
      trusted: boolean;
      firstSeen: string;
    }>;

    const device = devices.find((d) => d.fingerprint === deviceFingerprint);
    return device?.trusted ?? false;
  }

  /**
   * Marks a device as trusted for a user.
   */
  async markDeviceTrusted(
    realmId: string,
    userId: string,
    deviceFingerprint: string,
  ): Promise<void> {
    const profile = await this.prisma.userLoginProfile.findUnique({
      where: { userId },
    });

    const currentDevices =
      (profile?.knownDevices as Array<{
        fingerprint: string;
        trusted: boolean;
        firstSeen: string;
      }>) ?? [];

    const existingIndex = currentDevices.findIndex(
      (d) => d.fingerprint === deviceFingerprint,
    );

    if (existingIndex >= 0) {
      currentDevices[existingIndex].trusted = true;
    } else {
      currentDevices.push({
        fingerprint: deviceFingerprint,
        trusted: true,
        firstSeen: new Date().toISOString(),
      });
    }

    await this.prisma.userLoginProfile.upsert({
      where: { userId },
      create: {
        userId,
        realmId,
        knownDevices: currentDevices,
      },
      update: {
        knownDevices: currentDevices,
      },
    });

    this.logger.debug(
      `Device marked as trusted userId=${userId} fingerprint=${deviceFingerprint}`,
    );
  }

  /**
   * Gets devices with compliance issues for a realm.
   */
  async getNonCompliantDevices(
    realmId: string,
    limit = 100,
  ): Promise<DevicePostureSummary[]> {
    const records = await this.prisma.devicePostureRecord.findMany({
      where: {
        realmId,
        complianceStatus: 'NON_COMPLIANT',
      },
      orderBy: { reportedAt: 'desc' },
      take: limit,
    });

    return records.map((record) => ({
      sessionId: record.sessionId,
      deviceFingerprint: record.deviceFingerprint,
      osType: record.osType,
      osVersion: record.osVersion,
      trustTier: record.deviceTrustTier,
      complianceStatus: record.complianceStatus ?? 'UNKNOWN',
      lastReportedAt: record.reportedAt,
    }));
  }

  /**
   * Gets device trust tier statistics for a realm.
   */
  async getDeviceTrustStats(realmId: string): Promise<{
    total: number;
    byTier: Record<string, number>;
    compliant: number;
    nonCompliant: number;
    unknown: number;
  }> {
    const records = await this.prisma.devicePostureRecord.groupBy({
      by: ['deviceTrustTier', 'complianceStatus'],
      where: { realmId },
      _count: true,
    });

    const stats = {
      total: 0,
      byTier: {} as Record<string, number>,
      compliant: 0,
      nonCompliant: 0,
      unknown: 0,
    };

    for (const record of records) {
      const count = record._count;
      stats.total += count;

      if (record.deviceTrustTier) {
        stats.byTier[record.deviceTrustTier] =
          (stats.byTier[record.deviceTrustTier] ?? 0) + count;
      }

      if (record.complianceStatus === 'COMPLIANT') {
        stats.compliant += count;
      } else if (record.complianceStatus === 'NON_COMPLIANT') {
        stats.nonCompliant += count;
      } else {
        stats.unknown += count;
      }
    }

    return stats;
  }

  /**
   * Cleans up stale device posture records older than the specified days.
   */
  @Interval(86400_000) // every 24 hours
  async cleanupStalePostureRecords(): Promise<void> {
    const retentionDays = 30;
    const cutoffDate = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    );

    const result = await this.prisma.devicePostureRecord.deleteMany({
      where: {
        reportedAt: { lt: cutoffDate },
      },
    });

    if (result.count > 0) {
      this.logger.debug(
        `Device posture cleanup removed ${result.count} stale record(s) older than ${retentionDays} days`,
      );
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildDevicePostureData(
    record: {
      osVersion?: string | null;
      osBuild?: string | null;
      securityPatchLevel?: string | null;
      lastUpdateDate?: Date | null;
      diskEncrypted?: boolean | null;
      antivirusEnabled?: boolean | null;
      firewallEnabled?: boolean | null;
      screenLockEnabled?: boolean;
      managedDevice?: boolean;
      jailbroken?: boolean;
      complianceStatus?: string | null;
    } | null,
  ): DevicePostureData {
    if (!record) {
      return {
        osVersion: null,
        osBuild: null,
        patchLevel: null,
        encryptedDisk: false,
        screenLockEnabled: false,
        antivirusActive: false,
        firewallActive: false,
        jailbreakRoot: false,
        customFirmware: false,
        MDMEnrolled: false,
        lastSecurityScan: null,
        complianceStatus: 'UNKNOWN',
      };
    }

    const patchDate = record.securityPatchLevel
      ? new Date(record.securityPatchLevel)
      : record.lastUpdateDate;

    return {
      osVersion: record.osVersion ?? null,
      osBuild: record.osBuild ?? null,
      patchLevel: record.securityPatchLevel ?? null,
      encryptedDisk: record.diskEncrypted ?? false,
      screenLockEnabled: record.screenLockEnabled ?? false,
      antivirusActive: record.antivirusEnabled ?? false,
      firewallActive: record.firewallEnabled ?? false,
      jailbreakRoot: record.jailbroken ?? false,
      customFirmware: false,
      MDMEnrolled: record.managedDevice ?? false,
      lastSecurityScan: patchDate ?? null,
      complianceStatus:
        (record.complianceStatus as
          'COMPLIANT' | 'NON_COMPLIANT' | 'UNKNOWN') ?? 'UNKNOWN',
    };
  }

  private determineComplianceFailures(
    posture: DevicePostureData,
    record: {
      osType?: string | null;
      jailbroken?: boolean;
      diskEncrypted?: boolean | null;
      screenLockEnabled?: boolean;
      antivirusEnabled?: boolean | null;
      firewallEnabled?: boolean | null;
      managedDevice?: boolean;
      securityPatchLevel?: string | null;
      lastUpdateDate?: Date | null;
    } | null,
    config: PosturePolicyConfig,
    signal: ContinuousRiskSignal,
  ): DeviceComplianceFailure[] {
    const failures: DeviceComplianceFailure[] = [];

    // Critical: jailbroken or custom firmware
    if (posture.jailbreakRoot || posture.customFirmware) {
      failures.push({
        check: 'device_integrity',
        severity: 'CRITICAL',
        reason: 'Device is jailbroken or has custom firmware',
      });
    }

    // High: disk encryption required but not enabled
    if (config.requireEncryption && !posture.encryptedDisk) {
      failures.push({
        check: 'disk_encryption',
        severity: 'HIGH',
        reason: 'Disk encryption is not enabled',
      });
    }

    // High: screen lock required but not enabled
    if (config.requireLockScreen && !posture.screenLockEnabled) {
      failures.push({
        check: 'screen_lock',
        severity: 'HIGH',
        reason: 'Screen lock is not enabled',
      });
    }

    // High: MDM required but not enrolled
    if (config.requireMDM && !posture.MDMEnrolled) {
      failures.push({
        check: 'mdm_enrollment',
        severity: 'HIGH',
        reason: 'Device is not enrolled in MDM',
      });
    }

    // Medium: antivirus required but not enabled
    if (config.requireAntivirus && !posture.antivirusActive) {
      failures.push({
        check: 'antivirus',
        severity: 'MEDIUM',
        reason: 'Antivirus is not active',
      });
    }

    // Medium: firewall required but not enabled
    if (config.requireFirewall && !posture.firewallActive) {
      failures.push({
        check: 'firewall',
        severity: 'MEDIUM',
        reason: 'Firewall is not active',
      });
    }

    // Medium: security scan outdated
    if (posture.lastSecurityScan) {
      const daysSinceScan = Math.floor(
        (Date.now() - posture.lastSecurityScan.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (daysSinceScan > config.maxDaysSinceSecurityScan) {
        failures.push({
          check: 'security_scan',
          severity: 'MEDIUM',
          reason: `Security scan is outdated (${daysSinceScan} days since last scan)`,
        });
      }
    }

    // Low: OS type restrictions
    if (config.allowedOSTypes && posture.osVersion && record?.osType) {
      if (!config.allowedOSTypes.includes(record.osType)) {
        failures.push({
          check: 'os_type',
          severity: 'LOW',
          reason: `OS type ${record.osType} is not in allowed list`,
        });
      }
    }

    if (config.blockedOSTypes && record?.osType) {
      if (config.blockedOSTypes.includes(record.osType)) {
        failures.push({
          check: 'os_type',
          severity: 'MEDIUM',
          reason: `OS type ${record.osType} is blocked`,
        });
      }
    }

    // Add failures from posture signal evaluation
    if (signal.triggered && signal.score >= 20) {
      const signalFailures: DeviceComplianceFailure[] = [
        {
          check: 'device_posture_signal',
          severity: signal.score >= 40 ? 'HIGH' : 'MEDIUM',
          reason: signal.reason,
        },
      ];
      failures.push(...signalFailures);
    }

    return failures;
  }

  private determineComplianceWarnings(
    posture: DevicePostureData,
    record: {
      osVersion?: string | null;
      osBuild?: string | null;
    } | null,
    config: PosturePolicyConfig,
  ): DeviceComplianceWarning[] {
    const warnings: DeviceComplianceWarning[] = [];

    // OS version below minimum
    if (config.minOSVersion && posture.osVersion && record?.osVersion) {
      if (this.compareVersions(record.osVersion, config.minOSVersion) < 0) {
        warnings.push({
          check: 'os_version',
          reason: `OS version ${record.osVersion} is below minimum ${config.minOSVersion}`,
        });
      }
    }

    // Compliance status unknown
    if (posture.complianceStatus === 'UNKNOWN') {
      warnings.push({
        check: 'compliance_status',
        reason: 'Device compliance status has not been evaluated',
      });
    }

    return warnings;
  }

  private calculateTrustTier(
    posture: DevicePostureData,
    failures: DeviceComplianceFailure[],
    _signalScore: number,
  ): DeviceTrustTier {
    const factors: string[] = [];
    let score = 100;

    // Deduct for critical/high failures
    const criticalFailures = failures.filter(
      (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
    );
    score -= criticalFailures.length * 25;

    // Deduct for medium failures
    const mediumFailures = failures.filter((f) => f.severity === 'MEDIUM');
    score -= mediumFailures.length * 10;

    // Deduct for low failures
    const lowFailures = failures.filter((f) => f.severity === 'LOW');
    score -= lowFailures.length * 5;

    // Add positive factors
    if (posture.encryptedDisk) {
      factors.push('disk_encrypted');
    }
    if (posture.screenLockEnabled) {
      factors.push('screen_lock_enabled');
    }
    if (posture.MDMEnrolled) {
      factors.push('mdm_enrolled');
    }
    if (posture.antivirusActive) {
      factors.push('antivirus_active');
    }
    if (posture.firewallActive) {
      factors.push('firewall_active');
    }
    if (posture.lastSecurityScan) {
      const daysSinceScan = Math.floor(
        (Date.now() - posture.lastSecurityScan.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (daysSinceScan <= 7) {
        factors.push('recent_security_scan');
      }
    }

    // Determine tier based on score and failures
    let tier: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
    if (posture.jailbreakRoot || posture.customFirmware) {
      tier = 'LOW';
      factors.push('device_compromised');
    } else if (score >= 80 && criticalFailures.length === 0) {
      tier = 'HIGH';
    } else if (score >= 50) {
      tier = 'MEDIUM';
    } else {
      tier = 'LOW';
    }

    return {
      tier,
      score: Math.max(0, Math.min(100, score)),
      factors,
    };
  }

  private compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1 = v1Parts[i] ?? 0;
      const v2 = v2Parts[i] ?? 0;
      if (v1 > v2) return 1;
      if (v1 < v2) return -1;
    }

    return 0;
  }
}
