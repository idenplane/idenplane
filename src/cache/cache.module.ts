import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';

@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
