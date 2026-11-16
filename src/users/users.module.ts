import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { ThemeModule } from '../theme/theme.module.js';
import { ConsentModule } from '../consent/consent.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';

@Module({
  imports: [ThemeModule, ConsentModule, SessionsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
