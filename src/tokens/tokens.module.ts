import { Module } from '@nestjs/common';
import { TokensController } from './tokens.controller.js';
import { TokensService } from './tokens.service.js';
import { TokenBlacklistService } from './token-blacklist.service.js';
import { BackchannelLogoutService } from './backchannel-logout.service.js';
import { ClientAuthModule } from '../client-auth/client-auth.module.js';
import { CustomAttributesModule } from '../custom-attributes/custom-attributes.module.js';

@Module({
  imports: [ClientAuthModule, CustomAttributesModule],
  controllers: [TokensController],
  providers: [TokensService, TokenBlacklistService, BackchannelLogoutService],
  exports: [TokensService, TokenBlacklistService, BackchannelLogoutService],
})
export class TokensModule {}
