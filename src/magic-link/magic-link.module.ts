import { Module } from '@nestjs/common';
import { MagicLinkController } from './magic-link.controller.js';
import { MagicLinkService } from './magic-link.service.js';
import { ThemeModule } from '../theme/theme.module.js';

@Module({
  imports: [ThemeModule],
  controllers: [MagicLinkController],
  providers: [MagicLinkService],
  exports: [MagicLinkService],
})
export class MagicLinkModule {}
