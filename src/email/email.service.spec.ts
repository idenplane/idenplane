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

// Mock fetch for HTTP-based providers
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';

const fullSmtpRealm = {
  emailProvider: 'smtp',
  emailProviderConfig: null,
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpUser: 'user@example.com',
  smtpPassword: 'secret',
  smtpFrom: 'admin@example.com',
  smtpSecure: true,
};

describe('EmailService', () => {
  let service: EmailService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, text: async () => '' });
    prisma = createMockPrismaService();
    service = new EmailService(prisma as any);
  });

  // ─── isConfigured ──────────────────────────────────────────

  describe('isConfigured', () => {
    it('should return true when emailProvider is smtp and smtpHost is set', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        emailProvider: 'smtp',
        smtpHost: 'smtp.example.com',
      });

      expect(await service.isConfigured('my-realm')).toBe(true);
    });

    it('should return true when emailProvider is null and smtpHost is set (legacy)', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        emailProvider: null,
        smtpHost: 'smtp.example.com',
      });

      expect(await service.isConfigured('my-realm')).toBe(true);
    });

    it('should return false when emailProvider is smtp and smtpHost is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        emailProvider: 'smtp',
        smtpHost: null,
      });

      expect(await service.isConfigured('my-realm')).toBe(false);
    });

    it('should return false when emailProvider is none', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        emailProvider: 'none',
        smtpHost: 'smtp.example.com',
      });

      expect(await service.isConfigured('my-realm')).toBe(false);
    });

    it('should return true when emailProvider is resend', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        emailProvider: 'resend',
        smtpHost: null,
      });

      expect(await service.isConfigured('my-realm')).toBe(true);
    });

    it('should return false when realm is not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      expect(await service.isConfigured('non-existent')).toBe(false);
    });
  });

  // ─── sendEmail (SMTP) ─────────────────────────────────────

  describe('sendEmail via SMTP', () => {
    it('should return early when smtpHost is not set', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpRealm,
        smtpHost: null,
      });

      await expect(
        service.sendEmail('my-realm', 'to@test.com', 'Subject', '<p>Body</p>'),
      ).resolves.toBeUndefined();

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('should return early when emailProvider is none', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpRealm,
        emailProvider: 'none',
      });

      await expect(
        service.sendEmail('my-realm', 'to@test.com', 'Subject', '<p>Body</p>'),
      ).resolves.toBeUndefined();

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('should return early when realm is not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(
        service.sendEmail('missing', 'to@test.com', 'Subject', '<p>Body</p>'),
      ).resolves.toBeUndefined();

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('should create SMTP transporter with correct config', async () => {
      prisma.realm.findUnique.mockResolvedValue(fullSmtpRealm);

      await service.sendEmail('my-realm', 'to@test.com', 'Hello', '<p>Hi</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'user@example.com', pass: 'secret' },
      });
    });

    it('should call sendMail with from, to, subject, html', async () => {
      prisma.realm.findUnique.mockResolvedValue(fullSmtpRealm);

      await service.sendEmail('my-realm', 'to@test.com', 'Hello', '<p>Hi</p>');

      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'admin@example.com',
        to: 'to@test.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      });
    });

    it('should default from address to noreply@host when smtpFrom is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpRealm,
        smtpFrom: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'noreply@smtp.example.com' }),
      );
    });

    it('should omit auth when smtpUser is not set', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpRealm,
        smtpUser: null,
        smtpPassword: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });

    it('should default port to 587 when smtpPort is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpRealm,
        smtpPort: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 587 }),
      );
    });

    it('should use empty string for password when smtpUser is set but smtpPassword is null', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...fullSmtpRealm,
        smtpPassword: null,
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Test', '<p>Test</p>');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { user: 'user@example.com', pass: '' },
        }),
      );
    });
  });

  // ─── sendEmail (Resend) ───────────────────────────────────

  describe('sendEmail via Resend', () => {
    const resendRealm = {
      emailProvider: 'resend',
      emailProviderConfig: { resend: { apiKey: 're_test123', from: 'hello@example.com' } },
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      smtpSecure: false,
    };

    it('should POST to Resend API with correct payload', async () => {
      prisma.realm.findUnique.mockResolvedValue(resendRealm);

      await service.sendEmail('my-realm', 'to@test.com', 'Hi', '<p>Hello</p>');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer re_test123',
            'Content-Type': 'application/json',
          }),
        }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toMatchObject({
        from: 'hello@example.com',
        to: 'to@test.com',
        subject: 'Hi',
      });
    });

    it('should throw when Resend API returns non-ok response', async () => {
      prisma.realm.findUnique.mockResolvedValue(resendRealm);
      mockFetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'Invalid' });

      await expect(
        service.sendEmail('my-realm', 'to@test.com', 'Hi', '<p>Hello</p>'),
      ).rejects.toThrow('Resend API error 422');
    });

    it('should not call nodemailer when using Resend', async () => {
      prisma.realm.findUnique.mockResolvedValue(resendRealm);

      await service.sendEmail('my-realm', 'to@test.com', 'Hi', '<p>Hello</p>');

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });
  });

  // ─── sendEmail (SendGrid) ─────────────────────────────────

  describe('sendEmail via SendGrid', () => {
    const sendgridRealm = {
      emailProvider: 'sendgrid',
      emailProviderConfig: { sendgrid: { apiKey: 'SG.test', from: 'hello@example.com' } },
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      smtpSecure: false,
    };

    it('should POST to SendGrid API with correct payload', async () => {
      prisma.realm.findUnique.mockResolvedValue(sendgridRealm);

      await service.sendEmail('my-realm', 'to@test.com', 'Hi', '<p>Hello</p>');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer SG.test' }),
        }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.personalizations[0].to[0].email).toBe('to@test.com');
      expect(body.from.email).toBe('hello@example.com');
    });
  });

  // ─── sendEmail (Mailgun) ──────────────────────────────────

  describe('sendEmail via Mailgun', () => {
    const mailgunRealm = {
      emailProvider: 'mailgun',
      emailProviderConfig: {
        mailgun: { apiKey: 'key-abc', domain: 'mg.example.com', from: 'hello@mg.example.com', region: 'us' },
      },
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      smtpSecure: false,
    };

    it('should POST to Mailgun API with correct URL', async () => {
      prisma.realm.findUnique.mockResolvedValue(mailgunRealm);

      await service.sendEmail('my-realm', 'to@test.com', 'Hi', '<p>Hello</p>');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mailgun.net/v3/mg.example.com/messages',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should use EU base URL when region is eu', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...mailgunRealm,
        emailProviderConfig: {
          mailgun: { apiKey: 'key-abc', domain: 'mg.example.com', from: 'hello@mg.example.com', region: 'eu' },
        },
      });

      await service.sendEmail('my-realm', 'to@test.com', 'Hi', '<p>Hello</p>');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.eu.mailgun.net/v3/mg.example.com/messages',
        expect.anything(),
      );
    });
  });

  // ─── sendEmail (Postmark) ─────────────────────────────────

  describe('sendEmail via Postmark', () => {
    const postmarkRealm = {
      emailProvider: 'postmark',
      emailProviderConfig: { postmark: { serverToken: 'tok-abc', from: 'hello@example.com' } },
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      smtpSecure: false,
    };

    it('should POST to Postmark API with correct headers and payload', async () => {
      prisma.realm.findUnique.mockResolvedValue(postmarkRealm);

      await service.sendEmail('my-realm', 'to@test.com', 'Hi', '<p>Hello</p>');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.postmarkapp.com/email',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Postmark-Server-Token': 'tok-abc',
          }),
        }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.To).toBe('to@test.com');
      expect(body.From).toBe('hello@example.com');
    });
  });

  // ─── sendTestEmail ────────────────────────────────────────

  describe('sendTestEmail', () => {
    it('should return success when SMTP email sends successfully', async () => {
      prisma.realm.findUnique.mockResolvedValue(fullSmtpRealm);

      const result = await service.sendTestEmail('my-realm');

      expect(result).toEqual({ success: true });
    });

    it('should return error when provider is not configured', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        emailProvider: 'none',
        emailProviderConfig: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        smtpSecure: false,
      });

      const result = await service.sendTestEmail('my-realm');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should return error message on send failure', async () => {
      prisma.realm.findUnique.mockResolvedValue(fullSmtpRealm);
      mockSendMail.mockRejectedValue(new Error('Connection refused'));

      const result = await service.sendTestEmail('my-realm');

      expect(result).toEqual({ success: false, error: 'Connection refused' });
    });

    it('should return success when Resend email sends successfully', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        emailProvider: 'resend',
        emailProviderConfig: { resend: { apiKey: 're_test123', from: 'hello@example.com' } },
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        smtpSecure: false,
      });

      const result = await service.sendTestEmail('my-realm');

      expect(result).toEqual({ success: true });
    });
  });
});
