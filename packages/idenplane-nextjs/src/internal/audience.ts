/**
 * Fail at configuration time, not on every request, when `audience` is
 * missing: without it the helpers could not tell an access token issued to
 * this application from one issued to any other client of the realm.
 */
export function assertAudience(audience: unknown, where: string): void {
  const list = Array.isArray(audience) ? audience : [audience];
  if (list.length === 0 || !list.every((a) => typeof a === 'string' && a.length > 0)) {
    throw new TypeError(
      `Idenplane: ${where} requires \`audience\`: the client ID (or IDs) whose access tokens it accepts`,
    );
  }
}
