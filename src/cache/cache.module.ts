import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { CacheBusService } from './cache-bus.service.js';
import { CachedLookupsService } from './cached-lookups.service.js';

@Global()
@Module({
  providers: [CacheBusService, CacheService, CachedLookupsService],
  exports: [CacheBusService, CacheService, CachedLookupsService],
})
export class CacheModule {}
