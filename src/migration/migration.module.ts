import { Module } from '@nestjs/common';
import { MigrationController } from './migration.controller.js';
import { KeycloakImporterService } from './keycloak-importer.service.js';
import { Auth0ImporterService } from './auth0-importer.service.js';
import { PasswordMigrationService } from './password-migration.service.js';

@Module({
  controllers: [MigrationController],
  providers: [
    KeycloakImporterService,
    Auth0ImporterService,
    PasswordMigrationService,
  ],
  exports: [PasswordMigrationService],
})
export class MigrationModule {}
