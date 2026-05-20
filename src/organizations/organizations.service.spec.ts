import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

// ─── Mock Node.js dns module ─────────────────────────────
const mockResolveTxt = jest.fn();
jest.mock('dns', () => ({
  promises: {
    resolveTxt: (...args: unknown[]) => mockResolveTxt(...args),
  },
}));

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: MockPrismaService;

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
  } as Realm;

  const mockOrg = {
    id: 'org-1',
    realmId: 'realm-1',
    slug: 'acme-corp',
    name: 'Acme Corporation',
    displayName: null,
    description: null,
    enabled: true,
    logoUrl: null,
    primaryColor: null,
    requireMfa: false,
    verifiedDomains: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMember = {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    role: 'member',
    joinedAt: new Date(),
  };

  const mockUser = {
    id: 'user-1',
    realmId: 'realm-1',
    email: 'alice@acme.com',
    emailVerified: true,
    username: 'alice',
  };

  const mockInvitation = {
    id: 'inv-1',
    organizationId: 'org-1',
    email: 'alice@acme.com',
    role: 'member',
    token: 'test-token-abc',
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    createdAt: new Date(),
  };

  const mockSsoConnection = {
    id: 'sso-1',
    organizationId: 'org-1',
    type: 'oidc',
    name: 'Corporate OIDC',
    enabled: true,
    config: { issuer: 'https://idp.acme.com' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new OrganizationsService(prisma as any);
    mockResolveTxt.mockReset();
  });

  // ─── create ──────────────────────────────────────────────

  describe('create', () => {
    it('should create an organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      prisma.organization.create.mockResolvedValue(mockOrg);

      const result = await service.create(mockRealm, {
        slug: 'acme-corp',
        name: 'Acme Corporation',
      });

      expect(result).toEqual(mockOrg);
      expect(prisma.organization.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          realmId: 'realm-1',
          slug: 'acme-corp',
          name: 'Acme Corporation',
          enabled: true,
          requireMfa: false,
          verifiedDomains: [],
        }),
      });
    });

    it('should throw ConflictException when slug already exists', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);

      await expect(
        service.create(mockRealm, { slug: 'acme-corp', name: 'Acme' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── findAll ─────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all organizations in a realm', async () => {
      prisma.organization.findMany.mockResolvedValue([mockOrg]);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual([mockOrg]);
      expect(prisma.organization.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        orderBy: { name: 'asc' },
      });
    });

    it('should return an empty array when no organizations exist', async () => {
      prisma.organization.findMany.mockResolvedValue([]);
      const result = await service.findAll(mockRealm);
      expect(result).toEqual([]);
    });
  });

  // ─── findOne ─────────────────────────────────────────────

  describe('findOne', () => {
    it('should return an organization by slug', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.findOne(mockRealm, 'acme-corp');

      expect(result).toEqual(mockOrg);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { realmId_slug: { realmId: 'realm-1', slug: 'acme-corp' } },
      });
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.findOne(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update ──────────────────────────────────────────────

  describe('update', () => {
    it('should update an organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      const updated = { ...mockOrg, name: 'Acme Corp Updated' };
      prisma.organization.update.mockResolvedValue(updated);

      const result = await service.update(mockRealm, 'acme-corp', {
        name: 'Acme Corp Updated',
      });

      expect(result).toEqual(updated);
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { realmId_slug: { realmId: 'realm-1', slug: 'acme-corp' } },
        data: expect.objectContaining({ name: 'Acme Corp Updated' }),
      });
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'ghost', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ──────────────────────────────────────────────

  describe('remove', () => {
    it('should delete an organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organization.delete.mockResolvedValue(mockOrg);

      await service.remove(mockRealm, 'acme-corp');

      expect(prisma.organization.delete).toHaveBeenCalledWith({
        where: { realmId_slug: { realmId: 'realm-1', slug: 'acme-corp' } },
      });
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.remove(mockRealm, 'ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── addMember ───────────────────────────────────────────

  describe('addMember', () => {
    it('should add a user to an organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      prisma.organizationMember.create.mockResolvedValue(mockMember);

      const result = await service.addMember(mockRealm, 'acme-corp', {
        userId: 'user-1',
        role: 'member',
      });

      expect(result).toEqual(mockMember);
      expect(prisma.organizationMember.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          userId: 'user-1',
          role: 'member',
        },
      });
    });

    it('should throw NotFoundException when user does not exist in realm', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember(mockRealm, 'acme-corp', { userId: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when user is already a member', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);

      await expect(
        service.addMember(mockRealm, 'acme-corp', { userId: 'user-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should default to member role when role not provided', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      prisma.organizationMember.create.mockResolvedValue(mockMember);

      await service.addMember(mockRealm, 'acme-corp', { userId: 'user-1' });

      expect(prisma.organizationMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'member' }),
      });
    });
  });

  // ─── listMembers ─────────────────────────────────────────

  describe('listMembers', () => {
    it('should return all members of an organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationMember.findMany.mockResolvedValue([mockMember]);

      const result = await service.listMembers(mockRealm, 'acme-corp');

      expect(result).toEqual([mockMember]);
      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { joinedAt: 'asc' },
      });
    });
  });

  // ─── updateMemberRole ────────────────────────────────────

  describe('updateMemberRole', () => {
    it('should update the role of an existing member', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      const updated = { ...mockMember, role: 'admin' };
      prisma.organizationMember.update.mockResolvedValue(updated);

      const result = await service.updateMemberRole(
        mockRealm,
        'acme-corp',
        'user-1',
        {
          role: 'admin',
        },
      );

      expect(result).toEqual(updated);
      expect(prisma.organizationMember.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { role: 'admin' },
      });
    });

    it('should throw NotFoundException when member does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMemberRole(mockRealm, 'acme-corp', 'ghost', {
          role: 'admin',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeMember ────────────────────────────────────────

  describe('removeMember', () => {
    it('should remove a member from an organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.organizationMember.delete.mockResolvedValue(mockMember);

      await service.removeMember(mockRealm, 'acme-corp', 'user-1');

      expect(prisma.organizationMember.delete).toHaveBeenCalledWith({
        where: { id: 'member-1' },
      });
    });

    it('should throw NotFoundException when member does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(mockRealm, 'acme-corp', 'ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── createInvitation ────────────────────────────────────

  describe('createInvitation', () => {
    it('should create an invitation with a token and expiry', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.create.mockResolvedValue(mockInvitation);

      const result = await service.createInvitation(mockRealm, 'acme-corp', {
        email: 'bob@acme.com',
        role: 'member',
      });

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expiresAt');
      expect(typeof result.token).toBe('string');
      expect(prisma.organizationInvitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          email: 'bob@acme.com',
          role: 'member',
        }),
      });
      const callArg =
        prisma.organizationInvitation.create.mock.calls[0][0].data;
      expect(typeof callArg.token).toBe('string');
      expect(callArg.token.length).toBeGreaterThan(0);
      expect(callArg.expiresAt).toBeInstanceOf(Date);
      expect(callArg.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should lowercase the invitation email', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.create.mockResolvedValue(mockInvitation);

      await service.createInvitation(mockRealm, 'acme-corp', {
        email: 'BOB@ACME.COM',
      });

      const callArg =
        prisma.organizationInvitation.create.mock.calls[0][0].data;
      expect(callArg.email).toBe('bob@acme.com');
    });
  });

  // ─── acceptInvitation ────────────────────────────────────

  describe('acceptInvitation', () => {
    it('should accept a valid invitation and add member', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.findUnique.mockResolvedValue(
        mockInvitation,
      );
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.$transaction.mockImplementation(async (ops: any[]) => {
        return Promise.all(ops.map((op) => op));
      });
      prisma.organizationInvitation.update.mockResolvedValue({
        ...mockInvitation,
        acceptedAt: new Date(),
      });
      prisma.organizationMember.upsert.mockResolvedValue(mockMember);

      const result = await service.acceptInvitation(
        mockRealm,
        'acme-corp',
        'test-token-abc',
        'user-1',
      );

      expect(result).toEqual(mockMember);
    });

    it('should throw NotFoundException when invitation does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptInvitation(mockRealm, 'acme-corp', 'bad-token', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw GoneException when invitation has already been accepted', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        acceptedAt: new Date(),
      });

      await expect(
        service.acceptInvitation(
          mockRealm,
          'acme-corp',
          'test-token-abc',
          'user-1',
        ),
      ).rejects.toThrow(GoneException);
    });

    it('should throw GoneException when invitation has expired', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.acceptInvitation(
          mockRealm,
          'acme-corp',
          'test-token-abc',
          'user-1',
        ),
      ).rejects.toThrow(GoneException);
    });

    it('should throw NotFoundException when invitation belongs to a different organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        organizationId: 'other-org',
      });

      await expect(
        service.acceptInvitation(
          mockRealm,
          'acme-corp',
          'test-token-abc',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when no user exists for the invited email', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationInvitation.findUnique.mockResolvedValue(
        mockInvitation,
      );
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.acceptInvitation(
          mockRealm,
          'acme-corp',
          'test-token-abc',
          'ghost',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Domain verification token ────────────────────────────

  describe('generateDomainVerificationToken', () => {
    it('should generate a consistent, prefixed token', () => {
      const token = service.generateDomainVerificationToken(
        'org-1',
        'acme.com',
      );
      expect(token.startsWith('idenplane-domain-verification=')).toBe(true);
    });

    it('should be deterministic for the same inputs', () => {
      const t1 = service.generateDomainVerificationToken('org-1', 'acme.com');
      const t2 = service.generateDomainVerificationToken('org-1', 'acme.com');
      expect(t1).toBe(t2);
    });

    it('should differ for different orgs', () => {
      const t1 = service.generateDomainVerificationToken('org-1', 'acme.com');
      const t2 = service.generateDomainVerificationToken('org-2', 'acme.com');
      expect(t1).not.toBe(t2);
    });

    it('should differ for different domains', () => {
      const t1 = service.generateDomainVerificationToken('org-1', 'acme.com');
      const t2 = service.generateDomainVerificationToken('org-1', 'rival.com');
      expect(t1).not.toBe(t2);
    });
  });

  // ─── initiateDomainVerification ──────────────────────────

  describe('initiateDomainVerification', () => {
    it('should return TXT record instructions', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.initiateDomainVerification(
        mockRealm,
        'acme-corp',
        { domain: 'acme.com' },
      );

      expect(result.domain).toBe('acme.com');
      expect(result.txtRecord).toBe('_idenplane-challenge.acme.com');
      expect(result.txtValue).toContain('idenplane-domain-verification=');
    });

    it('should lowercase the domain', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.initiateDomainVerification(
        mockRealm,
        'acme-corp',
        { domain: 'ACME.COM' },
      );

      expect(result.domain).toBe('acme.com');
    });
  });

  // ─── verifyDomain ────────────────────────────────────────

  describe('verifyDomain', () => {
    it('should mark domain as verified when TXT record matches', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      const expectedTxt = service.generateDomainVerificationToken(
        'org-1',
        'acme.com',
      );

      mockResolveTxt.mockResolvedValue([[expectedTxt]]);

      prisma.organization.update.mockResolvedValue({
        ...mockOrg,
        verifiedDomains: ['acme.com'],
      });

      const result = await service.verifyDomain(mockRealm, 'acme-corp', {
        domain: 'acme.com',
      });

      expect(result.verified).toBe(true);
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { verifiedDomains: { push: 'acme.com' } },
      });
    });

    it('should return alreadyVerified true when domain is already in verifiedDomains', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...mockOrg,
        verifiedDomains: ['acme.com'],
      });

      const result = await service.verifyDomain(mockRealm, 'acme-corp', {
        domain: 'acme.com',
      });

      expect(result.alreadyVerified).toBe(true);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when DNS lookup fails', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockResolveTxt.mockRejectedValue(new Error('NXDOMAIN'));

      await expect(
        service.verifyDomain(mockRealm, 'acme-corp', { domain: 'acme.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when TXT value does not match', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockResolveTxt.mockResolvedValue([['wrong-value']]);

      await expect(
        service.verifyDomain(mockRealm, 'acme-corp', { domain: 'acme.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── autoAssignUserByEmailDomain ─────────────────────────

  describe('autoAssignUserByEmailDomain', () => {
    it('should add user to organizations with matching verified domain', async () => {
      prisma.organization.findMany.mockResolvedValue([mockOrg]);
      prisma.organizationMember.upsert.mockResolvedValue(mockMember);

      await service.autoAssignUserByEmailDomain(
        'realm-1',
        'user-1',
        'alice@acme.com',
      );

      expect(prisma.organizationMember.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_userId: {
            organizationId: 'org-1',
            userId: 'user-1',
          },
        },
        create: { organizationId: 'org-1', userId: 'user-1', role: 'member' },
        update: {},
      });
    });

    it('should do nothing when email has no domain part', async () => {
      await service.autoAssignUserByEmailDomain(
        'realm-1',
        'user-1',
        'no-at-sign',
      );
      expect(prisma.organization.findMany).not.toHaveBeenCalled();
    });

    it('should do nothing when no organizations have a matching domain', async () => {
      prisma.organization.findMany.mockResolvedValue([]);

      await service.autoAssignUserByEmailDomain(
        'realm-1',
        'user-1',
        'alice@unknown.com',
      );

      expect(prisma.organizationMember.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── SSO Connections ─────────────────────────────────────

  describe('createSsoConnection', () => {
    it('should create an SSO connection', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationSsoConnection.create.mockResolvedValue(
        mockSsoConnection,
      );

      const result = await service.createSsoConnection(mockRealm, 'acme-corp', {
        type: 'oidc',
        name: 'Corporate OIDC',
        config: { issuer: 'https://idp.acme.com' },
      });

      expect(result).toEqual(mockSsoConnection);
      expect(prisma.organizationSsoConnection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          type: 'oidc',
          name: 'Corporate OIDC',
          enabled: true,
        }),
      });
    });
  });

  describe('listSsoConnections', () => {
    it('should list SSO connections for an organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationSsoConnection.findMany.mockResolvedValue([
        mockSsoConnection,
      ]);

      const result = await service.listSsoConnections(mockRealm, 'acme-corp');

      expect(result).toEqual([mockSsoConnection]);
    });
  });

  describe('getSsoConnection', () => {
    it('should return an SSO connection by id', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationSsoConnection.findFirst.mockResolvedValue(
        mockSsoConnection,
      );

      const result = await service.getSsoConnection(
        mockRealm,
        'acme-corp',
        'sso-1',
      );

      expect(result).toEqual(mockSsoConnection);
    });

    it('should throw NotFoundException when connection does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationSsoConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.getSsoConnection(mockRealm, 'acme-corp', 'ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSsoConnection', () => {
    it('should update an SSO connection', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationSsoConnection.findFirst.mockResolvedValue(
        mockSsoConnection,
      );
      const updated = { ...mockSsoConnection, name: 'Updated Name' };
      prisma.organizationSsoConnection.update.mockResolvedValue(updated);

      const result = await service.updateSsoConnection(
        mockRealm,
        'acme-corp',
        'sso-1',
        { name: 'Updated Name' },
      );

      expect(result).toEqual(updated);
      expect(prisma.organizationSsoConnection.update).toHaveBeenCalledWith({
        where: { id: 'sso-1' },
        data: expect.objectContaining({ name: 'Updated Name' }),
      });
    });
  });

  describe('deleteSsoConnection', () => {
    it('should delete an SSO connection', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationSsoConnection.findFirst.mockResolvedValue(
        mockSsoConnection,
      );
      prisma.organizationSsoConnection.delete.mockResolvedValue(
        mockSsoConnection,
      );

      await service.deleteSsoConnection(mockRealm, 'acme-corp', 'sso-1');

      expect(prisma.organizationSsoConnection.delete).toHaveBeenCalledWith({
        where: { id: 'sso-1' },
      });
    });

    it('should throw NotFoundException when connection does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.organizationSsoConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSsoConnection(mockRealm, 'acme-corp', 'ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
