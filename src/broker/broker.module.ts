import { Module } from '@nestjs/common';
import { BrokerController } from './broker.controller.js';
import { BrokerService } from './broker.service.js';
import { IdentityProvidersModule } from '../identity-providers/identity-providers.module.js';
import { ThemeModule } from '../theme/theme.module.js';

@Module({
  imports: [IdentityProvidersModule, ThemeModule],
  controllers: [BrokerController],
  providers: [BrokerService],
})
export class BrokerModule {}
