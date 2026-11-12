import { Module } from '@nestjs/common';
import { OAuthService } from './oauth.service.js';

/** The authorization-code service, without the authorization endpoint. */
@Module({
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthCoreModule {}
