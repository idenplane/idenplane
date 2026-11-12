import { jwtVerify, type JWTVerifyGetKey } from 'jose';

interface ProfileAuthConfig {
  issuer: string;
  audience: string;
}

// A resource server trusts deployment configuration, never token-supplied URLs.
export function createProfileHandler(config: ProfileAuthConfig, keys: JWTVerifyGetKey) {
  return async (request: Request, userId: string): Promise<Response> => {
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
    const unauthorized = () => Response.json({ error: 'unauthorized' }, {
      status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' },
    });
    const authorization = request.headers.get('authorization');
    const match = authorization?.match(/^Bearer ([^\s,]+)$/i);
    if (!match) return unauthorized();

    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], keys, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256'],
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'azp'],
      }));
      if (payload.typ !== 'Bearer' || payload.azp !== config.audience || typeof payload.sub !== 'string' || !payload.sub) return unauthorized();
    } catch {
      return unauthorized();
    }

    const scopes = new Set(typeof payload.scope === 'string' ? payload.scope.split(' ') : []);
    // Ownership is checked inside the endpoint, independently of page guards.
    if (payload.sub !== userId || !scopes.has('profile')) {
      return Response.json({ error: 'forbidden' }, { status: 403, headers });
    }

    return Response.json({ profile: {
      id: payload.sub,
      username: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      email: scopes.has('email') && typeof payload.email === 'string' ? payload.email : undefined,
    } }, { headers });
  };
}
