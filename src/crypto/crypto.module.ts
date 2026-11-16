import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service.js';
import { JwkService } from './jwk.service.js';
import { PasswordVerificationService } from './password-verification.service.js';

@Global()
@Module({
  providers: [CryptoService, JwkService, PasswordVerificationService],
  exports: [CryptoService, JwkService, PasswordVerificationService],
})
export class CryptoModule {}
