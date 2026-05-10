import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateConsentCategoryDto } from './dto/create-consent-category.dto.js';
import { UpdateConsentCategoryDto } from './dto/update-consent-category.dto.js';

const CATEGORY_SELECT = {
  id: true,
  realmId: true,
  key: true,
  displayName: true,
  description: true,
  required: true,
  configurableByUser: true,
  showInAccountPortal: true,
  order: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ConsentCategoryService {
  private readonly logger = new Logger(ConsentCategoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new consent category for a realm.
   */
  async create(realm: Realm, dto: CreateConsentCategoryDto) {
    const existing = await this.prisma.consentCategory.findUnique({
      where: {
        realmId_key: { realmId: realm.id, key: dto.key },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Consent category with key '${dto.key}' already exists in realm '${realm.name}'`,
      );
    }

    return this.prisma.consentCategory.create({
      data: {
        realmId: realm.id,
        key: dto.key,
        displayName: dto.displayName,
        description: dto.description,
        required: dto.required ?? false,
        configurableByUser: dto.configurableByUser ?? true,
        showInAccountPortal: dto.showInAccountPortal ?? true,
        order: dto.order ?? 0,
        enabled: dto.enabled ?? true,
      },
      select: CATEGORY_SELECT,
    });
  }

  /**
   * Find all consent categories for a realm.
   */
  async findAll(realm: Realm, includeDisabled = false) {
    return this.prisma.consentCategory.findMany({
      where: {
        realmId: realm.id,
        ...(includeDisabled ? {} : { enabled: true }),
      },
      select: CATEGORY_SELECT,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Find a single consent category by ID.
   */
  async findById(realm: Realm, id: string) {
    const category = await this.prisma.consentCategory.findUnique({
      where: { id },
      select: CATEGORY_SELECT,
    });
    if (!category || category.realmId !== realm.id) {
      throw new NotFoundException(`Consent category '${id}' not found`);
    }
    return category;
  }

  /**
   * Find a single consent category by key.
   */
  async findByKey(realm: Realm, key: string) {
    const category = await this.prisma.consentCategory.findUnique({
      where: {
        realmId_key: { realmId: realm.id, key },
      },
      select: CATEGORY_SELECT,
    });
    if (!category) {
      throw new NotFoundException(`Consent category '${key}' not found`);
    }
    return category;
  }

  /**
   * Update a consent category.
   */
  async update(realm: Realm, id: string, dto: UpdateConsentCategoryDto) {
    // Verify the category exists and belongs to this realm
    await this.findById(realm, id);

    return this.prisma.consentCategory.update({
      where: { id },
      data: {
        ...(dto.key !== undefined && { key: dto.key }),
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.required !== undefined && { required: dto.required }),
        ...(dto.configurableByUser !== undefined && { configurableByUser: dto.configurableByUser }),
        ...(dto.showInAccountPortal !== undefined && { showInAccountPortal: dto.showInAccountPortal }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      },
      select: CATEGORY_SELECT,
    });
  }

  /**
   * Delete a consent category.
   */
  async delete(realm: Realm, id: string) {
    await this.findById(realm, id);
    await this.prisma.consentCategory.delete({ where: { id } });
  }

  /**
   * Get categories that should be shown in the account portal.
   */
  async getPortalCategories(realm: Realm) {
    return this.prisma.consentCategory.findMany({
      where: {
        realmId: realm.id,
        enabled: true,
        showInAccountPortal: true,
      },
      select: CATEGORY_SELECT,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
