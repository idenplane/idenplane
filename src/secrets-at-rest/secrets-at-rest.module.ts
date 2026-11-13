import { Module } from '@nestjs/common';
import { SecretsAtRestService } from './secrets-at-rest.service.js';

/** Encrypts legacy plaintext secrets and checks the key, on every start. */
@Module({
  providers: [SecretsAtRestService],
})
export class SecretsAtRestModule {}
