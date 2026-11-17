import { DataExportService } from './data-export.service';
import type { PrismaService } from '../prisma/prisma.service';

const at = new Date('2026-01-01T00:00:00Z');

function setup(user: Record<string, unknown>) {
  const empty = jest.fn().mockResolvedValue([]);
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    userConsentHistory: { findMany: empty },
    loginEvent: { findMany: empty },
    organizationMember: { findMany: empty },
  };
  return new DataExportService(prisma as unknown as PrismaService);
}

const baseUser = {
  id: 'u-1',
  username: 'ada',
  email: 'ada@example.com',
  emailVerified: true,
  firstName: 'Ada',
  lastName: 'Lovelace',
  enabled: true,
  federationLink: null,
  scimExternalId: null,
  scimProfile: null,
  createdAt: at,
  updatedAt: at,
  userRoles: [],
  userGroups: [],
  consents: [],
  federatedIdentities: [],
  sessions: [],
  attributes: [],
  userCredentials: [],
  recoveryCodes: [],
  webAuthnCredentials: [],
  pendingDeletion: null,
  loginRiskAssessments: [],
  userLoginProfile: null,
  loginFailures: [],
  loginSessions: [],
};

describe('DataExportService', () => {
  it('includes what SCIM provisioned about the user', async () => {
    const profile = {
      title: 'Engineer',
      phoneNumbers: [{ type: 'work', value: '+44 20 7946 0000' }],
      enterprise: { department: 'Research' },
    };
    const service = setup({
      ...baseUser,
      scimExternalId: 'entra-oid',
      scimProfile: profile,
    });
    const data = await service.exportUserData('u-1');
    expect(data.user.scimExternalId).toBe('entra-oid');
    expect(data.user.scimProfile).toEqual(profile);
  });

  it('exports null for a user SCIM never described', async () => {
    const data = await setup(baseUser).exportUserData('u-1');
    expect(data.user.scimExternalId).toBeNull();
    expect(data.user.scimProfile).toBeNull();
  });
});
