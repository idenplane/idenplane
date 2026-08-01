import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { CryptoModule } from '../crypto/crypto.module.js';

@Global()
@Module({
  imports: [CryptoModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
