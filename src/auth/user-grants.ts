import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * What a token or a userinfo response says about a user's grants: realm and
 * client roles, direct and inherited through groups (deduplicated), and
 * custom-attribute claims.
 *
 * Cached per user by CachedLookupsService.userGrants, which drops it when any
 * of those rows change. Every caller loads it with `loadUserGrants`, so the
 * cached value always has this one shape.
 */
export interface UserGrants {
  attributeClaims: Record<string, string>;
  realmRoles: string[];
  resourceAccess: Record<string, { roles: string[] }>;
}

interface AttributeClaimsSource {
  getOidcClaimsForUser(userId: string): Promise<Record<string, string>>;
}

type RoleWithClient = {
  id: string;
  name: string;
  clientId: string | null;
  client: { clientId: string } | null;
};

/** Reads a user's grants from the database. */
export async function loadUserGrants(
  prisma: PrismaService,
  attributes: AttributeClaimsSource,
  userId: string,
): Promise<UserGrants> {
  const [attributeClaims, userRoles, groupRoles] = await Promise.all([
    attributes.getOidcClaimsForUser(userId),
    prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { client: true } } },
    }),
    resolveGroupRoles(prisma, userId),
  ]);

  const seenRoleIds = new Set<string>();
  const roles = [...userRoles.map((ur) => ur.role), ...groupRoles].filter(
    (r) => {
      if (seenRoleIds.has(r.id)) return false;
      seenRoleIds.add(r.id);
      return true;
    },
  );

  const realmRoles = roles.filter((r) => !r.clientId).map((r) => r.name);
  const resourceAccess: Record<string, { roles: string[] }> = {};
  for (const role of roles) {
    if (role.client) {
      (resourceAccess[role.client.clientId] ??= { roles: [] }).roles.push(
        role.name,
      );
    }
  }
  return { attributeClaims, realmRoles, resourceAccess };
}

/** The roles of every group the user is in, and of each group's ancestors. */
async function resolveGroupRoles(
  prisma: PrismaService,
  userId: string,
): Promise<RoleWithClient[]> {
  const memberships = await prisma.userGroup.findMany({
    where: { userId },
    select: { groupId: true },
  });
  if (memberships.length === 0) return [];

  const allRoles: RoleWithClient[] = [];
  const visited = new Set<string>();

  const walkGroup = async (groupId: string): Promise<void> => {
    if (visited.has(groupId)) return;
    visited.add(groupId);

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        groupRoles: { include: { role: { include: { client: true } } } },
      },
    });
    if (!group) return;

    for (const gr of group.groupRoles) allRoles.push(gr.role);
    if (group.parentId) await walkGroup(group.parentId);
  };

  for (const m of memberships) await walkGroup(m.groupId);
  return allRoles;
}
