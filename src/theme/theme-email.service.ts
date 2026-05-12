import { Injectable, Logger } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { readFileSync } from 'fs';
import Handlebars from 'handlebars';
import { ThemeService } from './theme.service.js';
import { ThemeTemplateService } from './theme-template.service.js';
import { ThemeMessageService } from './theme-message.service.js';

@Injectable()
export class ThemeEmailService {
  private readonly logger = new Logger(ThemeEmailService.name);
  private compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();

  constructor(
    private readonly themeService: ThemeService,
    private readonly templateService: ThemeTemplateService,
    private readonly messageService: ThemeMessageService,
  ) {}

  /**
   * Renders an email template with theme support.
   *
   * @param realm - The current realm
   * @param templateName - Email template name (e.g., "verify-email", "reset-password")
   * @param data - Template data (URLs, user info, etc.)
   * @returns Rendered HTML string
   */
  renderEmail(
    realm: Realm,
    templateName: string,
    data: Record<string, any>,
  ): string {
    const themeName = this.themeService.getRealmThemeName(realm, 'email');
    const templatePath = this.templateService.resolve(
      themeName,
      'email',
      templateName,
    );
    const messages = this.messageService.getMessages(themeName, 'email', 'en');
    const colors = this.themeService.resolveColors(themeName, realm);

    const compiled = this.getCompiledTemplate(templatePath);

    return compiled({
      ...data,
      ...colors,
      _messages: messages,
      realmName: realm.name,
      realmDisplayName: realm.displayName ?? realm.name,
    });
  }

  /**
   * Gets a message value for use as email subject.
   */
  getSubject(realm: Realm, messageKey: string): string {
    const themeName = this.themeService.getRealmThemeName(realm, 'email');
    const messages = this.messageService.getMessages(themeName, 'email', 'en');
    return messages[messageKey] ?? messageKey;
  }

  private getCompiledTemplate(
    templatePath: string,
  ): HandlebarsTemplateDelegate {
    let compiled = this.compiledTemplates.get(templatePath);
    if (!compiled) {
      const source = readFileSync(templatePath, 'utf-8');
      this.registerHelpers();
      compiled = Handlebars.compile(source);
      this.compiledTemplates.set(templatePath, compiled);
    }
    return compiled;
  }

  private helpersRegistered = false;

  private registerHelpers(): void {
    if (this.helpersRegistered) return;
    Handlebars.registerHelper('msg', function (key: string, options: any) {
      const messages: Record<string, string> =
        options?.data?.root?._messages ?? {};
      return messages[key] ?? key;
    });
    Handlebars.registerHelper(
      'msgArgs',
      function (key: string, ...args: any[]) {
        const options = args.pop();
        const messages: Record<string, string> =
          options?.data?.root?._messages ?? {};
        let text = messages[key] ?? key;
        for (let i = 0; i < args.length; i++) {
          text = text.replace(`{${i}}`, String(args[i] ?? ''));
        }
        return text;
      },
    );
    this.helpersRegistered = true;
  }
}
