// Mock JwkService module to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

// Mock nodemailer before importing anything that uses it
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: mockSendMail,
  }),
}));

import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('EmailService', () => {
  let service: EmailService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    service = new EmailService(prisma as any);
  });

  // ─── isConfigured ──────────────────────────────────────────

  describe('isConfigured', () => {
    it('should return true when smtpHost is set', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        smtpHost: 'smtp.example.com',
      });

      const result = await service.isConfigured('my-realm');

      expect(result).toBe(true);
      expect(prisma.realm.findUnique).toHaveBeenCalledWith({
        where: { name: 'my-realm' },
        select: { smtpHost: true },
      });
    });

    it('should return false when smtpHost is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smtpHost: null });

      const result = await service.isConfigured('my-realm');

      expect(result).toBe(false);
    });

    it('should return false when realm is not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      const result = await service.isConfigured('non-existent');

      expect(result).toBe(false);
    });

    it('should return false when smtpHost is an empty string', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smtpHost: '' });

      const result = await service.isConfigured('my-realm');

      expect(result).toBe(false);
    });
  });

  // ─── sendEmail ─────────────────────────────────────────────

  describe('sendEmail', () => {
    const fullSmtpConfig = {
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpUser: 'user@example.com',
      smtpPassword: 'secret',
      smtpFrom: 'admin@example.com',
      smtpSecure: true,
    };

    it('should return early without throwing when smtpHost is not configured', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smtpHost: null });

      await expect(
        service.sendEmail('my-realm', 'to@test.com', 'Subject', '<p>Body</p>'),
      ).resolves.toBeUndefined();

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('should return early without throwing when realm is not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(
        service.sendEmail('missing', 'to@test.com', 'Subject', '<p>Body</p>'),
      ).resolves.toBeUndefined();

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('should create transporter with correct SMTP config', async () => {
      prisma.realm.findUnique.mockResolvedValue(fullSmtpConfig);

      await service.sendEmail('my-realm', 'to@test.com', 'Hello', '<p>Hi</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'user@example.com', pass: 'secret' },
      });
    });

    it('should call sendMail with from, to, subject, html', async () => {
      prisma.realm.findUnique.mockResolvedValue(fullSmtpConfig);

      await service.sendEmail('my-realm', 'to@test.com', 'Hello', '<p>Hi</p>');

      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'admin@example.com',
        to: 'to@test.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      });
    });

    it('should use default from address (noreply@host) when smtpFrom is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpConfig,
        smtpFrom: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@smtp.example.com',
        }),
      );
    });

    it('should omit auth when smtpUser is not set', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpConfig,
        smtpUser: null,
        smtpPassword: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: undefined,
        }),
      );
    });

    it('should default port to 587 when smtpPort is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpConfig,
        smtpPort: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 587,
        }),
      );
    });

    it('should use empty string for password when smtpUser is set but smtpPassword is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpConfig,
        smtpPassword: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { user: 'user@example.com', pass: '' },
        }),
      );
    });

    it('should query realm with correct SMTP select fields', async () => {
      prisma.realm.findUnique.mockResolvedValue(fullSmtpConfig);

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(prisma.realm.findUnique).toHaveBeenCalledWith({
        where: { name: 'my-realm' },
        select: {
          smtpHost: true,
          smtpPort: true,
          smtpUser: true,
          smtpPassword: true,
          smtpFrom: true,
          smtpSecure: true,
        },
      });
    });
  });
});
