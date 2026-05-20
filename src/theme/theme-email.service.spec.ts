import { ThemeEmailService } from './theme-email.service.js';

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('Hello {{username}}, visit {{url}}'),
}));

import { readFileSync } from 'fs';
const mockedReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;

describe('ThemeEmailService', () => {
  let service: ThemeEmailService;
  let themeService: {
    getRealmThemeName: jest.Mock;
    resolveColors: jest.Mock;
  };
  let templateService: {
    resolve: jest.Mock;
  };
  let messageService: {
    getMessages: jest.Mock;
  };

  const mockRealm = {
    name: 'test-realm',
    displayName: 'Test Realm',
    theme: {},
  } as any;

  beforeEach(() => {
    themeService = {
      getRealmThemeName: jest.fn().mockReturnValue('idenplane'),
      resolveColors: jest.fn().mockReturnValue({
        primaryColor: '#2563eb',
        backgroundColor: '#f0f2f5',
      }),
    };
    templateService = {
      resolve: jest
        .fn()
        .mockReturnValue('/app/themes/idenplane/email/templates/verify-email.hbs'),
    };
    messageService = {
      getMessages: jest.fn().mockReturnValue({
        verifyEmailSubject: 'Verify your email',
        greeting: 'Hello',
      }),
    };

    service = new ThemeEmailService(
      themeService as any,
      templateService as any,
      messageService as any,
    );

    jest.clearAllMocks();
    mockedReadFileSync.mockReturnValue('Hello {{username}}, visit {{url}}');
  });

  describe('renderEmail', () => {
    it('should render email template with merged data', () => {
      const result = service.renderEmail(mockRealm, 'verify-email', {
        username: 'testuser',
        url: 'https://example.com/verify',
      });

      expect(themeService.getRealmThemeName).toHaveBeenCalledWith(
        mockRealm,
        'email',
      );
      expect(templateService.resolve).toHaveBeenCalledWith(
        'idenplane',
        'email',
        'verify-email',
      );
      expect(messageService.getMessages).toHaveBeenCalledWith(
        'idenplane',
        'email',
        'en',
      );
      expect(result).toContain('testuser');
      expect(result).toContain('https://example.com/verify');
    });

    it('should include realm name in template data', () => {
      mockedReadFileSync.mockReturnValue(
        'Realm: {{realmName}}, Display: {{realmDisplayName}}',
      );

      // Clear template cache by creating new instance
      service = new ThemeEmailService(
        themeService as any,
        templateService as any,
        messageService as any,
      );

      const result = service.renderEmail(mockRealm, 'test', {});

      expect(result).toContain('test-realm');
      expect(result).toContain('Test Realm');
    });

    it('should cache compiled templates', () => {
      service.renderEmail(mockRealm, 'verify-email', { username: 'user1' });
      service.renderEmail(mockRealm, 'verify-email', { username: 'user2' });

      // readFileSync should only be called once for the same template path
      expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
    });

    it('should use realm name as displayName fallback', () => {
      const realmNoDisplay = { ...mockRealm, displayName: null };
      mockedReadFileSync.mockReturnValue('{{realmDisplayName}}');

      service = new ThemeEmailService(
        themeService as any,
        templateService as any,
        messageService as any,
      );

      const result = service.renderEmail(realmNoDisplay, 'test', {});
      expect(result).toBe('test-realm');
    });
  });

  describe('getSubject', () => {
    it('should return message value for the key', () => {
      const subject = service.getSubject(mockRealm, 'verifyEmailSubject');

      expect(subject).toBe('Verify your email');
    });

    it('should return key itself when message is not found', () => {
      const subject = service.getSubject(mockRealm, 'nonExistentKey');

      expect(subject).toBe('nonExistentKey');
    });
  });
});
