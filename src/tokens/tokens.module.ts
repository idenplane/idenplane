import { Module } from '@nestjs/common';
import { TokensController } from './tokens.controller.js';
import { TokensService } from './tokens.service.js';
import { TokenBlacklistService } from './token-blacklist.service.js';
import { BackchannelLogoutModule } from './backchannel-logout.module.js';
import { ClientAuthModule } from '../client-auth/client-auth.module.js';
import { CustomAttributesModule } from '../custom-attributes/custom-attributes.module.js';

@Module({
  imports: [ClientAuthModule, CustomAttributesModule, BackchannelLogoutModule],
  controllers: [TokensController],
  providers: [TokensService, TokenBlacklistService],
  exports: [TokensService, TokenBlacklistService, BackchannelLogoutModule],
})
export class TokensModule {}
