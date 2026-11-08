import { Module } from '@nestjs/common';
import { ClientSecretService } from './client-secret.service.js';

/** Prisma, Crypto and Cache are global modules, so nothing to import. */
@Module({
  providers: [ClientSecretService],
  exports: [ClientSecretService],
})
export class ClientSecretModule {}
