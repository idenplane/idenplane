import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { CacheBusService } from './cache-bus.service.js';
import { CachedLookupsService } from './cached-lookups.service.js';
import { LeaderService } from './leader.service.js';

@Global()
@Module({
  providers: [
    CacheBusService,
    CacheService,
    CachedLookupsService,
    LeaderService,
  ],
  exports: [CacheBusService, CacheService, CachedLookupsService, LeaderService],
})
export class CacheModule {}
