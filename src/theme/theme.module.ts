import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { I18nService } from './i18n.service.js';
import { ThemeEmailService } from './theme-email.service.js';
import { ThemeMessageService } from './theme-message.service.js';
import { ThemePreviewService } from './theme-preview.service.js';
import { ThemeRenderService } from './theme-render.service.js';
import { ThemeTemplateService } from './theme-template.service.js';
import { ThemeUploadService } from './theme-upload.service.js';
import { GlobalThemeController, ThemeController } from './theme.controller.js';
import { ThemeService } from './theme.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ThemeController, GlobalThemeController],
  providers: [
    ThemeService,
    ThemePreviewService,
    ThemeTemplateService,
    ThemeMessageService,
    ThemeRenderService,
    ThemeEmailService,
    ThemeUploadService,
    I18nService,
  ],
  exports: [
    ThemeService,
    ThemePreviewService,
    ThemeTemplateService,
    ThemeMessageService,
    ThemeRenderService,
    ThemeEmailService,
    ThemeUploadService,
    I18nService,
  ],
})
export class ThemeModule {}
