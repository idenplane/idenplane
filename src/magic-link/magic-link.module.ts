import { Module } from '@nestjs/common';
import { MagicLinkController } from './magic-link.controller.js';
import { MagicLinkService } from './magic-link.service.js';

@Module({
  controllers: [MagicLinkController],
  providers: [MagicLinkService],
  exports: [MagicLinkService],
})
export class MagicLinkModule {}
