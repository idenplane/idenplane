import { Module } from '@nestjs/common';
import { SecretsAtRestService } from './secrets-at-rest.service.js';
import { AdminEventPurgeService } from './admin-event-purge.service.js';

/**
 * Encrypts legacy plaintext secrets and checks the key, on every start;
 * removes secrets older admin events recorded, once, after the start.
 */
@Module({
  providers: [SecretsAtRestService, AdminEventPurgeService],
})
export class SecretsAtRestModule {}
