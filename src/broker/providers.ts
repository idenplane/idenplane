/**
 * Well-known provider configurations for convenience.
 * Admins can use these as templates when creating identity providers.
 */
export const WELL_KNOWN_PROVIDERS: Record<
  string,
  {
    authorizationUrl: string;
    tokenUrl: string;
    userinfoUrl: string;
    jwksUrl: string;
    issuer: string;
    defaultScopes: string;
  }
> = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    defaultScopes: 'openid email profile',
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    jwksUrl: '',
    issuer: '',
    defaultScopes: 'read:user user:email',
  },
  microsoft: {
    authorizationUrl:
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    issuer: 'https://login.microsoftonline.com/common/v2.0',
    defaultScopes: 'openid email profile',
  },
};
