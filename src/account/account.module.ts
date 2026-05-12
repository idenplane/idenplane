import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { LoginModule } from '../login/login.module.js';
import { ThemeModule } from '../theme/theme.module.js';
import { WebAuthnModule } from '../webauthn/webauthn.module.js';
import { DataExportService } from './data-export.service.js';
import { AccountDeletionService } from './account-deletion.service.js';

@Module({
  imports: [LoginModule, ThemeModule, WebAuthnModule],
  controllers: [AccountController],
  providers: [DataExportService, AccountDeletionService],
})
export class AccountModule {}
