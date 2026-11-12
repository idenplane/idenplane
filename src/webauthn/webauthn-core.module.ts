import { Module } from '@nestjs/common';
import { WebAuthnService } from './webauthn.service.js';

/** The WebAuthn service, without the passkey endpoints. */
@Module({
  providers: [WebAuthnService],
  exports: [WebAuthnService],
})
export class WebAuthnCoreModule {}
