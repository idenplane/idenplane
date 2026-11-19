import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module.js';
import { RealmsModule } from '../realms/realms.module.js';
import { SetupWizardModule } from '../setup-wizard/setup-wizard.module.js';
import { InstanceBootstrapService } from './instance-bootstrap.service.js';

/** Sets up a fresh instance from BOOTSTRAP_FILE at its first start. */
@Module({
  imports: [CryptoModule, RealmsModule, SetupWizardModule],
  providers: [InstanceBootstrapService],
  exports: [InstanceBootstrapService],
})
export class InstanceBootstrapModule {}
