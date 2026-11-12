import { Module } from '@nestjs/common';
import { LoginService } from './login.service.js';
import { UserFederationModule } from '../user-federation/user-federation.module.js';
import { MigrationModule } from '../migration/migration.module.js';
import { CsrfService } from '../common/csrf/csrf.service.js';

/**
 * The login services, without the login pages. Modules that need to
 * authenticate a user or read the SSO session import this, never
 * LoginModule, so no controller module depends on another.
 */
@Module({
  imports: [UserFederationModule, MigrationModule],
  providers: [LoginService, CsrfService],
  exports: [LoginService, CsrfService],
})
export class LoginCoreModule {}
