import { Module } from '@nestjs/common';
import { ClientScopesController } from './client-scopes.controller.js';
import { ClientScopesService } from './client-scopes.service.js';
import { ClientsModule } from '../clients/clients.module.js';

@Module({
  imports: [ClientsModule],
  controllers: [ClientScopesController],
  providers: [ClientScopesService],
  exports: [ClientScopesService],
})
export class ClientScopesModule {}
