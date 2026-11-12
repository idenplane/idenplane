import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { ThemeModule } from '../theme/theme.module.js';
import { WebAuthnCoreModule } from '../webauthn/webauthn-core.module.js';
import { DataExportService } from './data-export.service.js';
import { AccountDeletionService } from './account-deletion.service.js';

@Module({
  imports: [LoginCoreModule, ThemeModule, WebAuthnCoreModule],
  controllers: [AccountController],
  providers: [DataExportService, AccountDeletionService],
})
export class AccountModule {}
