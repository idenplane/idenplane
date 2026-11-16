import type { Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import { ADMIN_TOKEN_TTL_SECONDS } from './admin-auth.service.js';

/** The HttpOnly cookie that lets the console survive a page reload. */
export const ADMIN_RT_COOKIE = 'admin_rt';

/** Puts a new admin token in the session cookie (path /admin/auth). */
export function setAdminSessionCookie(
  res: Response,
  token: string,
  config: ConfigService,
): void {
  res.cookie(ADMIN_RT_COOKIE, token, {
    httpOnly: true,
    secure: config.get<string>('NODE_ENV') === 'production',
    sameSite: 'strict',
    maxAge: ADMIN_TOKEN_TTL_SECONDS * 1000,
    path: '/admin/auth',
  });
}

/** The bearer token a request was authenticated with, if any. */
export function bearerTokenOf(req: Request): string | undefined {
  const header = req.headers['authorization'];
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : undefined;
}
