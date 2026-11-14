import { Module } from '@nestjs/common';
import { FlowBindingResolver } from './flow-binding.resolver.js';

/**
 * The flow binding resolver, without the admin endpoints or the runtime.
 * Its only dependency is Prisma, so the login core (SessionIssuer) and the
 * authorization endpoint can import it without joining a module cycle.
 */
@Module({
  providers: [FlowBindingResolver],
  exports: [FlowBindingResolver],
})
export class AuthFlowCoreModule {}
