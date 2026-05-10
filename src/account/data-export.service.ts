import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserDataExport {
  version: number;
  exportedAt: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    emailVerified: boolean;
    firstName: string | null;
    lastName: string | null;
    enabled: boolean;
    federationLink: string | null;
    createdAt: string;
    updatedAt: string;
  };
  roles: Array<{
    name: string;
    clientId: string | null;
  }>;
  groups: string[];
  consents: Array<{
    clientId: string;
    clientName: string | null;
    scopes: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  consentHistory: Array<{
    clientId: string;
    action: string;
    scopes: string[];
    policyVersion: string | null;
    timestamp: string;
  }>;
  federatedIdentities: Array<{
    providerAlias: string;
    providerDisplayName: string | null;
    externalUserId: string;
    externalUsername: string | null;
    externalEmail: string | null;
    linkedAt: string;
  }>;
  sessions: Array<{
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    expiresAt: string;
  }>;
  loginEvents: Array<{
    type: string;
    clientId: string | null;
    ipAddress: string | null;
    error: string | null;
    timestamp: string;
  }>;
  customAttributes: Array<{
    name: string;
    displayName: string;
    value: string;
  }>;
  mfaCredentials: {
    totp: {
      enabled: boolean;
      verified: boolean;
      createdAt: string;
    } | null;
    webAuthn: Array<{
      credentialId: string;
      deviceType: string;
      backedUp: boolean;
      friendlyName: string | null;
      transports: string[];
      createdAt: string;
      lastUsedAt: string | null;
    }>;
    recoveryCodesRemaining: number;
  };
  deletionRequest: {
    requestedAt: string | null;
    scheduledAt: string | null;
    gracePeriodDays: number;
    status: string | null;
    exportStatus: string | null;
  } | null;
  riskProfile: {
    avgLoginFrequency: number;
    knownDevices: string[];
    knownIps: string[];
    lastLocations: string[];
  } | null;
  organizationMemberships: Array<{
    organizationName: string;
    organizationDisplayName: string | null;
    role: string;
    joinedAt: string;
  }>;
}

@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportUserData(userId: string): Promise<UserDataExport> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
        userGroups: { include: { group: true } },
        consents: { include: { client: true } },
        federatedIdentities: { include: { identityProvider: true } },
        sessions: true,
        userAttributes: { include: { attribute: true } },
        userCredentials: true,
        recoveryCodes: { where: { used: false } },
        webAuthnCredentials: true,
        pendingDeletion: true,
        loginRiskAssessments: true,
        userLoginProfile: true,
        loginFailures: true,
        loginSessions: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID '${userId}' not found`);
    }

    // Fetch consent history
    const consentHistory = await this.prisma.userConsentHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Fetch login events
    const loginEvents = await this.prisma.loginEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Fetch organization memberships
    const orgMembers = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
    });

    // Build the export data
    const exportData: UserDataExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: user.enabled,
        federationLink: user.federationLink,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      roles: user.userRoles.map(ur => ({
        name: ur.role.name,
        clientId: ur.role.clientId ?? null,
      })),
      groups: user.userGroups.map(ug => ug.group.name),
      consents: user.consents.map(c => ({
        clientId: c.client.clientId,
        clientName: c.client.name,
        scopes: c.scopes,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      consentHistory: consentHistory.map(ch => ({
        clientId: ch.clientId,
        action: ch.action,
        scopes: ch.scopes,
        policyVersion: ch.policyVersion,
        timestamp: ch.createdAt.toISOString(),
      })),
      federatedIdentities: user.federatedIdentities.map(fi => ({
        providerAlias: fi.identityProvider.alias,
        providerDisplayName: fi.identityProvider.displayName,
        externalUserId: fi.externalUserId,
        externalUsername: fi.externalUsername,
        externalEmail: fi.externalEmail,
        linkedAt: fi.createdAt.toISOString(),
      })),
      sessions: user.sessions.map(s => ({
        id: s.id,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
      loginEvents: loginEvents.map(e => ({
        type: e.type,
        clientId: e.clientId,
        ipAddress: e.ipAddress,
        error: e.error,
        timestamp: e.createdAt.toISOString(),
      })),
      customAttributes: user.userAttributes.map(ua => ({
        name: ua.attribute.name,
        displayName: ua.attribute.displayName,
        value: ua.value,
      })),
      mfaCredentials: this.buildMfaCredentials(user),
      deletionRequest: user.pendingDeletion ? {
        requestedAt: user.pendingDeletion.requestedAt.toISOString(),
        scheduledAt: user.pendingDeletion.scheduledAt.toISOString(),
        gracePeriodDays: user.pendingDeletion.gracePeriodDays,
        status: user.pendingDeletion.status,
        exportStatus: user.pendingDeletion.exportStatus,
      } : null,
      riskProfile: user.userLoginProfile ? {
        avgLoginFrequency: user.userLoginProfile.avgLoginFrequency,
        knownDevices: user.userLoginProfile.knownDevices as string[],
        knownIps: user.userLoginProfile.knownIps as string[],
        lastLocations: user.userLoginProfile.lastLocations as string[],
      } : null,
      organizationMemberships: orgMembers.map(m => ({
        organizationName: m.organization.name,
        organizationDisplayName: m.organization.displayName,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
    };

    return exportData;
  }

  private buildMfaCredentials(user: {
    userCredentials: Array<{
      type: string;
      verified: boolean;
      createdAt: Date;
    }>;
    webAuthnCredentials: Array<{
      credentialId: string;
      deviceType: string;
      backedUp: boolean;
      friendlyName: string | null;
      transports: string[];
      createdAt: Date;
      lastUsedAt: Date | null;
    }>;
    recoveryCodes: Array<{ id: string }>;
  }) {
    const totpCredential = user.userCredentials.find(c => c.type === 'totp');

    return {
      totp: totpCredential ? {
        enabled: true,
        verified: totpCredential.verified,
        createdAt: totpCredential.createdAt.toISOString(),
      } : null,
      webAuthn: user.webAuthnCredentials.map(c => ({
        credentialId: c.credentialId,
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        friendlyName: c.friendlyName,
        transports: c.transports,
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
      })),
      recoveryCodesRemaining: user.recoveryCodes.length,
    };
  }

  async exportUserDataAsJson(userId: string): Promise<string> {
    const exportData = await this.exportUserData(userId);
    return JSON.stringify(exportData, null, 2);
  }
}