import { Module } from '@nestjs/common';
import { WellKnownController } from './well-known.controller.js';
import { CacheModule } from '../cache/cache.module.js';
import { MtlsModule } from '../mtls/mtls.module.js';

@Module({
  imports: [CacheModule, MtlsModule],
  controllers: [WellKnownController],
})
export class WellKnownModule {}
