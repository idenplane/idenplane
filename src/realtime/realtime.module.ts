import { Module } from '@nestjs/common';
import { SessionEventsGateway } from './session-events.gateway.js';
import { TokensModule } from '../tokens/tokens.module.js';
import { MtlsModule } from '../mtls/mtls.module.js';

@Module({
  imports: [TokensModule, MtlsModule],
  providers: [SessionEventsGateway],
  exports: [SessionEventsGateway],
})
export class RealtimeModule {}
