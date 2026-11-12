import { createRemoteJWKSet } from 'jose';
import { createProfileHandler } from '../../../../../lib/server-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const serverUrl = (process.env.NEXT_PUBLIC_IDENPLANE_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const realm = process.env.NEXT_PUBLIC_IDENPLANE_REALM ?? 'quickstart';
const audience = process.env.NEXT_PUBLIC_IDENPLANE_CLIENT_ID ?? 'nextjs-quickstart';
// Docker can fetch public signing keys through its private service network while
// validating the exact public issuer seen by the browser. This is server-only.
const internalUrl = (process.env.IDENPLANE_INTERNAL_URL ?? serverUrl).replace(/\/$/, '');
const issuer = `${serverUrl}/realms/${encodeURIComponent(realm)}`;
const keys = createRemoteJWKSet(new URL(`${internalUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/certs`));
const profile = createProfileHandler({ issuer, audience }, keys);

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  return profile(request, userId);
}
