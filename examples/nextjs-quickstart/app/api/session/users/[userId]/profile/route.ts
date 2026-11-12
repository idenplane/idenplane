import { handleSessionRequest } from '../../../../../../lib/session/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  return handleSessionRequest('profile', request, (await context.params).userId);
}
