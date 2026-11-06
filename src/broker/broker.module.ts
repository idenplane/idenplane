import { Module } from '@nestjs/common';
import { BrokerController } from './broker.controller.js';
import { BrokerService } from './broker.service.js';
import { IdentityProvidersModule } from '../identity-providers/identity-providers.module.js';
import { ThemeModule } from '../theme/theme.module.js';
import { LoginModule } from '../login/login.module.js';

@Module({
  imports: [IdentityProvidersModule, ThemeModule, LoginModule],
  controllers: [BrokerController],
  providers: [BrokerService],
})
export class BrokerModule {}
