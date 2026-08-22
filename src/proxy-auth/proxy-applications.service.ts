import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ProxyApplication, type Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProxyAuthService } from './proxy-auth.service.js';
import { CreateProxyApplicationDto } from './dto/create-proxy-application.dto.js';
import { UpdateProxyApplicationDto } from './dto/update-proxy-application.dto.js';

/**
 * What the admin API returns alongside a proxy application: the callback URL
 * that has to be registered on the OAuth client, and whether it currently is.
 *
 * Surfacing this is the difference between a five-minute setup and an
 * afternoon — the failure mode otherwise is a redirect_uri mismatch at the end
 * of a login the admin has already completed, with nothing pointing at the
 * cause.
 */
export interface ProxyApplicationView {
  application: ProxyApplication;
  callbackUrl: string;
  callbackRegistered: boolean;
}

@Injectable()
export class ProxyApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proxyAuth: ProxyAuthService,
  ) {}

  async create(
    realm: Realm,
    dto: CreateProxyApplicationDto,
  ): Promise<ProxyApplicationView> {
    const client = await this.prisma.client.findUnique({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: dto.clientId },
      },
      select: { id: true, redirectUris: true },
    });

    if (!client) {
      throw new NotFoundException(
        `Client '${dto.clientId}' not found in realm '${realm.name}'`,
      );
    }

    this.assertCookieDomainCovers(dto.cookieDomain, dto.allowedRedirectUris);

    try {
      const application = await this.prisma.proxyApplication.create({
        data: {
          realmId: realm.id,
          clientId: client.id,
          slug: dto.slug,
          name: dto.name,
          allowedRedirectUris: dto.allowedRedirectUris,
          cookieDomain: dto.cookieDomain,
          ...(dto.cookieTtl !== undefined ? { cookieTtl: dto.cookieTtl } : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...this.headerOverrides(dto),
        },
      });

      return this.toView(realm, application, client.redirectUris);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A proxy application with slug '${dto.slug}' already exists in this realm`,
        );
      }
      throw error;
    }
  }

  async findAll(realm: Realm): Promise<ProxyApplicationView[]> {
    const applications = await this.prisma.proxyApplication.findMany({
      where: { realmId: realm.id },
      orderBy: { slug: 'asc' },
      include: { client: { select: { redirectUris: true } } },
    });

    return applications.map((a) =>
      this.toView(realm, a, a.client.redirectUris),
    );
  }

  async findOne(realm: Realm, slug: string): Promise<ProxyApplicationView> {
    const application = await this.prisma.proxyApplication.findUnique({
      where: { realmId_slug: { realmId: realm.id, slug } },
      include: { client: { select: { redirectUris: true } } },
    });

    if (!application) {
      throw new NotFoundException(`Proxy application '${slug}' not found`);
    }

    return this.toView(realm, application, application.client.redirectUris);
  }

  async update(
    realm: Realm,
    slug: string,
    dto: UpdateProxyApplicationDto,
  ): Promise<ProxyApplicationView> {
    const existing = await this.prisma.proxyApplication.findUnique({
      where: { realmId_slug: { realmId: realm.id, slug } },
    });

    if (!existing) {
      throw new NotFoundException(`Proxy application '${slug}' not found`);
    }

    // Validate the resulting state, not just the incoming fields: changing only
    // the cookie domain, or only the redirect URIs, can break their
    // relationship just as easily as changing both.
    const cookieDomain = dto.cookieDomain ?? existing.cookieDomain;
    const allowedRedirectUris =
      dto.allowedRedirectUris ?? existing.allowedRedirectUris;
    this.assertCookieDomainCovers(cookieDomain, allowedRedirectUris);

    let clientDbId: string | undefined;
    let redirectUris: string[];

    if (dto.clientId) {
      const client = await this.prisma.client.findUnique({
        where: {
          realmId_clientId: { realmId: realm.id, clientId: dto.clientId },
        },
        select: { id: true, redirectUris: true },
      });
      if (!client) {
        throw new NotFoundException(
          `Client '${dto.clientId}' not found in realm '${realm.name}'`,
        );
      }
      clientDbId = client.id;
      redirectUris = client.redirectUris;
    } else {
      const client = await this.prisma.client.findUnique({
        where: { id: existing.clientId },
        select: { redirectUris: true },
      });
      redirectUris = client?.redirectUris ?? [];
    }

    const application = await this.prisma.proxyApplication.update({
      where: { id: existing.id },
      data: {
        ...(clientDbId ? { clientId: clientDbId } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.cookieTtl !== undefined ? { cookieTtl: dto.cookieTtl } : {}),
        cookieDomain,
        allowedRedirectUris,
        ...this.headerOverrides(dto),
      },
    });

    return this.toView(realm, application, redirectUris);
  }

  /**
   * Delete an application. Its sessions go with it via the FK cascade, which is
   * the point: removing a protected application must not leave live cookies
   * that would authenticate against a re-created one with the same slug.
   */
  async remove(realm: Realm, slug: string): Promise<void> {
    const existing = await this.prisma.proxyApplication.findUnique({
      where: { realmId_slug: { realmId: realm.id, slug } },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(`Proxy application '${slug}' not found`);
    }

    await this.prisma.proxyApplication.delete({ where: { id: existing.id } });
  }

  /** Revoke every live session for an application without deleting it. */
  async revokeSessions(
    realm: Realm,
    slug: string,
  ): Promise<{ revoked: number }> {
    const existing = await this.prisma.proxyApplication.findUnique({
      where: { realmId_slug: { realmId: realm.id, slug } },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(`Proxy application '${slug}' not found`);
    }

    const { count } = await this.prisma.proxySession.deleteMany({
      where: { proxyApplicationId: existing.id },
    });

    return { revoked: count };
  }

  // ─── helpers ──────────────────────────────────────────────

  /**
   * A cookie scoped to `.example.com` is simply never sent to
   * `app.other.test`, so an application configured that way fails with an
   * infinite redirect loop and no error anywhere. Cheap to catch here; genuinely
   * hard to diagnose in production.
   */
  private assertCookieDomainCovers(
    cookieDomain: string,
    allowedRedirectUris: string[],
  ): void {
    const domain = cookieDomain.startsWith('.')
      ? cookieDomain.slice(1)
      : cookieDomain;

    for (const uri of allowedRedirectUris) {
      let host: string;
      try {
        host = new URL(uri.replace(/\/\*$/, '/')).hostname;
      } catch {
        throw new BadRequestException(
          `'${uri}' is not a valid absolute URL. Allowed redirect URIs must include the scheme, e.g. https://app.example.com/*`,
        );
      }

      if (host !== domain && !host.endsWith(`.${domain}`)) {
        throw new BadRequestException(
          `cookieDomain '${cookieDomain}' does not cover '${host}'. The browser would never send the proxy session cookie to that host, and every request would redirect to login forever.`,
        );
      }
    }
  }

  private headerOverrides(
    dto: CreateProxyApplicationDto | UpdateProxyApplicationDto,
  ) {
    return {
      ...(dto.userHeader !== undefined ? { userHeader: dto.userHeader } : {}),
      ...(dto.emailHeader !== undefined
        ? { emailHeader: dto.emailHeader }
        : {}),
      ...(dto.nameHeader !== undefined ? { nameHeader: dto.nameHeader } : {}),
      ...(dto.groupsHeader !== undefined
        ? { groupsHeader: dto.groupsHeader }
        : {}),
    };
  }

  private toView(
    realm: Realm,
    application: ProxyApplication,
    clientRedirectUris: string[],
  ): ProxyApplicationView {
    const callbackUrl = this.proxyAuth.callbackUrl(
      realm.name,
      application.slug,
    );

    return {
      application,
      callbackUrl,
      callbackRegistered: clientRedirectUris.includes(callbackUrl),
    };
  }
}
