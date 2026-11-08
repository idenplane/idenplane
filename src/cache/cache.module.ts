import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { CacheBusService } from './cache-bus.service.js';

@Global()
@Module({
  providers: [CacheBusService, CacheService],
  exports: [CacheBusService, CacheService],
})
export class CacheModule {}
