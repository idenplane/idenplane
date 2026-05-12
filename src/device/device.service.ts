import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { Interval } from '@nestjs/schedule';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async initiateDeviceAuth(realm: Realm, clientId: string, scope?: string) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client || !client.enabled) {
      throw new NotFoundException('Client not found');
    }
    // Accept both the full RFC 8628 URN and the shorthand alias so that clients
    // stored with either value are permitted (issue #503).
    const supportsDeviceFlow =
      client.grantTypes.includes(
        'urn:ietf:params:oauth:grant-type:device_code',
      ) || client.grantTypes.includes('device_code');
    if (!supportsDeviceFlow) {
      throw new BadRequestException(
        'Client does not support device authorization',
      );
    }

    const deviceCode = randomBytes(32).toString('hex');
    const userCode = this.generateUserCode();
    const expiresAt = new Date(Date.now() + 600_000); // 10 minutes

    await this.prisma.deviceCode.create({
      data: {
        deviceCode,
        userCode,
        clientId: client.id,
        realmId: realm.id,
        scope: scope ?? null,
        expiresAt,
        interval: 5,
      },
    });

    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${baseUrl}/realms/${realm.name}/device`,
      verification_uri_complete: `${baseUrl}/realms/${realm.name}/device?user_code=${userCode}`,
      expires_in: 600,
      interval: 5,
    };
  }

  async approveDevice(realm: Realm, userCode: string, userId: string) {
    const device = await this.prisma.deviceCode.findUnique({
      where: { userCode },
    });
    if (!device || device.realmId !== realm.id) {
      throw new NotFoundException('Invalid user code');
    }
    if (device.expiresAt < new Date()) {
      throw new BadRequestException('Device code has expired');
    }

    await this.prisma.deviceCode.update({
      where: { id: device.id },
      data: { approved: true, userId },
    });
  }

  async denyDevice(realm: Realm, userCode: string) {
    const device = await this.prisma.deviceCode.findUnique({
      where: { userCode },
    });
    if (!device || device.realmId !== realm.id) {
      throw new NotFoundException('Invalid user code');
    }

    await this.prisma.deviceCode.update({
      where: { id: device.id },
      data: { denied: true },
    });
  }

  @Interval(600_000) // every 10 minutes — matches the device-code TTL
  async cleanupExpiredDeviceCodes(): Promise<void> {
    const result = await this.prisma.deviceCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    if (result.count > 0) {
      this.logger.debug(
        `Device-code cleanup removed ${result.count} expired device code(s)`,
      );
    }
  }

  private generateUserCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      // randomInt(max) is rejection-sampling based and therefore unbiased,
      // unlike the bytes[i] % N pattern which has modulo bias when 256 % N != 0.
      code += chars[randomInt(chars.length)];
      if (i === 3) code += '-';
    }
    return code;
  }
}
