import type { PrismaService } from '../prisma/prisma.service.js';
import type { FlowValidationContext } from './flow-validator.js';

/**
 * What the validator checks against the realm: today, which identity
 * providers a `social` step may name (enabled ones only). Loaded by every
 * caller that validates a flow for real use: saving, binding and the
 * binding resolver at login.
 */
export async function loadFlowValidationContext(
  prisma: Pick<PrismaService, 'identityProvider'>,
  realmId: string,
): Promise<FlowValidationContext> {
  const providers = await prisma.identityProvider.findMany({
    where: { realmId, enabled: true },
    select: { alias: true },
  });
  return {
    identityProviderAliases: new Set(providers.map((p) => p.alias)),
  };
}
