import { Module, Global } from '@nestjs/common';
import { ConsentService } from './consent.service.js';
import { ConsentCategoryService } from './consent-category.service.js';
import { ConsentStatisticsService } from './consent-stats.service.js';
import { ConsentCategoriesController } from './consent-categories.controller.js';
import { CryptoModule } from '../crypto/crypto.module.js';

@Global()
@Module({
  imports: [CryptoModule],
  controllers: [ConsentCategoriesController],
  providers: [ConsentService, ConsentCategoryService, ConsentStatisticsService],
  exports: [ConsentService, ConsentCategoryService, ConsentStatisticsService],
})
export class ConsentModule {}
