import { Module } from '@nestjs/common';
import { BrokerService } from './broker.service.js';
import { IdentityProvidersModule } from '../identity-providers/identity-providers.module.js';

/**
 * The identity-broker service without its endpoints, so the flow runtime
 * (a `social` step) can use it while the broker's controller calls the
 * runtime, without a module cycle.
 */
@Module({
  imports: [IdentityProvidersModule],
  providers: [BrokerService],
  exports: [BrokerService],
})
export class BrokerCoreModule {}
