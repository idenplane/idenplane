import { handleSessionRequest } from '../../../../lib/session/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleSessionRequest('callback', request);
