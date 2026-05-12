import { Module } from '@nestjs/common';
import { CustomAttributesService } from './custom-attributes.service.js';
import {
  CustomAttributesController,
  UserAttributesController,
} from './custom-attributes.controller.js';

@Module({
  controllers: [CustomAttributesController, UserAttributesController],
  providers: [CustomAttributesService],
  exports: [CustomAttributesService],
})
export class CustomAttributesModule {}
