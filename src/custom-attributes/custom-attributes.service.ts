import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomAttributeDto } from './dto/create-custom-attribute.dto.js';
import { UpdateCustomAttributeDto } from './dto/update-custom-attribute.dto.js';

@Injectable()
export class CustomAttributesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Attribute Definitions ────────────────────────────────────────────

  async createAttribute(realm: Realm, dto: CreateCustomAttributeDto) {
    this.validateOptionsForType(dto.type ?? 'text', dto.options);

    try {
      return await this.prisma.customAttribute.create({
        data: {
          realmId: realm.id,
          name: dto.name,
          displayName: dto.displayName,
          type: dto.type ?? 'text',
          required: dto.required ?? false,
          showOnRegistration: dto.showOnRegistration ?? false,
          showOnProfile: dto.showOnProfile ?? true,
          options: dto.options
            ? (dto.options as unknown as Prisma.InputJsonValue)
            : undefined,
          mapToOidcClaim: dto.mapToOidcClaim,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Attribute '${dto.name}' already exists in this realm`,
        );
      }
      throw error;
    }
  }

  async findAllAttributes(realm: Realm) {
    return this.prisma.customAttribute.findMany({
      where: { realmId: realm.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findAttributeById(realm: Realm, attributeId: string) {
    const attribute = await this.prisma.customAttribute.findFirst({
      where: { id: attributeId, realmId: realm.id },
    });
    if (!attribute) {
      throw new NotFoundException(`Custom attribute not found`);
    }
    return attribute;
  }

  async findAttributeByName(realmId: string, name: string) {
    return this.prisma.customAttribute.findUnique({
      where: { realmId_name: { realmId, name } },
    });
  }

  async updateAttribute(
    realm: Realm,
    attributeId: string,
    dto: UpdateCustomAttributeDto,
  ) {
    await this.findAttributeById(realm, attributeId);

    if (dto.type || dto.options !== undefined) {
      const type =
        dto.type ?? (await this.findAttributeById(realm, attributeId)).type;
      this.validateOptionsForType(type, dto.options);
    }

    try {
      return await this.prisma.customAttribute.update({
        where: { id: attributeId },
        data: {
          displayName: dto.displayName,
          type: dto.type,
          required: dto.required,
          showOnRegistration: dto.showOnRegistration,
          showOnProfile: dto.showOnProfile,
          options:
            dto.options !== undefined
              ? (dto.options as unknown as Prisma.InputJsonValue)
              : undefined,
          mapToOidcClaim: dto.mapToOidcClaim,
          sortOrder: dto.sortOrder,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Attribute name conflict`);
      }
      throw error;
    }
  }

  async removeAttribute(realm: Realm, attributeId: string) {
    await this.findAttributeById(realm, attributeId);
    await this.prisma.customAttribute.delete({ where: { id: attributeId } });
  }

  // ─── User Attribute Values ────────────────────────────────────────────

  async getUserAttributes(realm: Realm, userId: string) {
    await this.assertUserInRealm(realm.id, userId);

    const values = await this.prisma.userAttribute.findMany({
      where: { userId },
      include: { attribute: true },
      orderBy: { attribute: { sortOrder: 'asc' } },
    });

    return values.map((v) => ({
      attributeId: v.attributeId,
      name: v.attribute.name,
      displayName: v.attribute.displayName,
      type: v.attribute.type,
      value: v.value,
    }));
  }

  async setUserAttributes(
    realm: Realm,
    userId: string,
    attributes: Record<string, string>,
  ) {
    await this.assertUserInRealm(realm.id, userId);

    const realmAttributes = await this.findAllAttributes(realm);
    const attrByName = new Map(realmAttributes.map((a) => [a.name, a]));

    // Validate all provided attribute names belong to this realm
    for (const name of Object.keys(attributes)) {
      if (!attrByName.has(name)) {
        throw new BadRequestException(
          `Unknown attribute '${name}' for this realm`,
        );
      }
    }

    // Validate required attributes that are being set have a non-empty value
    for (const [name, attr] of attrByName) {
      if (attr.required && name in attributes && !attributes[name]?.trim()) {
        throw new BadRequestException(
          `Attribute '${attr.displayName}' is required and cannot be empty`,
        );
      }
      // Validate type
      if (name in attributes) {
        this.validateAttributeValue(
          attr.type,
          attributes[name],
          attr.displayName,
          attr.options as string[] | null,
        );
      }
    }

    // Upsert all provided attributes
    const ops = Object.entries(attributes).map(([name, value]) => {
      const attr = attrByName.get(name)!;
      return this.prisma.userAttribute.upsert({
        where: { userId_attributeId: { userId, attributeId: attr.id } },
        create: { userId, attributeId: attr.id, value },
        update: { value },
      });
    });

    await this.prisma.$transaction(ops);
    return this.getUserAttributes(realm, userId);
  }

  // ─── Registration Helpers ─────────────────────────────────────────────

  async getRegistrationAttributes(realmId: string) {
    return this.prisma.customAttribute.findMany({
      where: { realmId, showOnRegistration: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async validateAndSaveRegistrationAttributes(
    realm: Realm,
    userId: string,
    body: Record<string, string>,
  ) {
    const attributes = await this.getRegistrationAttributes(realm.id);
    if (attributes.length === 0) return;

    for (const attr of attributes) {
      const fieldKey = `attr_${attr.name}`;
      const rawValue = body[fieldKey] ?? '';
      const value = rawValue.trim();

      if (attr.required && !value) {
        throw new BadRequestException(`'${attr.displayName}' is required`);
      }

      if (value) {
        this.validateAttributeValue(
          attr.type,
          value,
          attr.displayName,
          attr.options as string[] | null,
        );
      }
    }

    // Save values
    const ops = attributes
      .filter((attr) => {
        const val = (body[`attr_${attr.name}`] ?? '').trim();
        return val.length > 0;
      })
      .map((attr) => {
        const value = (body[`attr_${attr.name}`] ?? '').trim();
        return this.prisma.userAttribute.create({
          data: { userId, attributeId: attr.id, value },
        });
      });

    if (ops.length > 0) {
      await this.prisma.$transaction(ops);
    }
  }

  // ─── OIDC Claim Resolution ────────────────────────────────────────────

  async getOidcClaimsForUser(userId: string): Promise<Record<string, string>> {
    const values = await this.prisma.userAttribute.findMany({
      where: { userId },
      include: { attribute: true },
    });

    const claims: Record<string, string> = {};
    for (const v of values) {
      if (v.attribute.mapToOidcClaim) {
        claims[v.attribute.mapToOidcClaim] = v.value;
      }
    }
    return claims;
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private async assertUserInRealm(realmId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId },
    });
    if (!user) throw new NotFoundException('User not found');
  }

  private validateOptionsForType(type: string, options?: string[]) {
    if (
      (type === 'select' || type === 'multi-select') &&
      (!options || options.length === 0)
    ) {
      throw new BadRequestException(
        `Attribute type '${type}' requires at least one option`,
      );
    }
  }

  private validateAttributeValue(
    type: string,
    value: string,
    displayName: string,
    options: string[] | null,
  ) {
    switch (type) {
      case 'number':
        if (isNaN(Number(value))) {
          throw new BadRequestException(`'${displayName}' must be a number`);
        }
        break;
      case 'boolean':
        if (
          !['true', 'false', '1', '0', 'yes', 'no'].includes(
            value.toLowerCase(),
          )
        ) {
          throw new BadRequestException(
            `'${displayName}' must be a boolean value`,
          );
        }
        break;
      case 'select':
        if (options && !options.includes(value)) {
          throw new BadRequestException(
            `'${displayName}' must be one of: ${options.join(', ')}`,
          );
        }
        break;
      case 'multi-select':
        if (options) {
          const selected = value.split(',').map((v) => v.trim());
          for (const s of selected) {
            if (!options.includes(s)) {
              throw new BadRequestException(
                `'${displayName}' contains invalid option: ${s}`,
              );
            }
          }
        }
        break;
      default:
        break;
    }
  }
}
