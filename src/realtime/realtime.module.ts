import { Module } from '@nestjs/common';
import { SessionEventsGateway } from './session-events.gateway.js';
import { TokensModule } from '../tokens/tokens.module.js';

@Module({
  imports: [TokensModule],
  providers: [SessionEventsGateway],
  exports: [SessionEventsGateway],
})
export class RealtimeModule {}
