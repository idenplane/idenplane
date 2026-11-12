import { Module } from '@nestjs/common';
import { LoginCoreModule } from '../login/login-core.module.js';
import { SamlIdpController } from './saml-idp.controller.js';
import { SamlSpAdminController } from './saml-sp-admin.controller.js';
import { SamlIdpService } from './saml-idp.service.js';
import { SamlMetadataService } from './saml-metadata.service.js';

@Module({
  imports: [LoginCoreModule],
  controllers: [SamlIdpController, SamlSpAdminController],
  providers: [SamlIdpService, SamlMetadataService],
  exports: [SamlIdpService],
})
export class SamlModule {}
