export interface ClientTemplate {
  id: string;
  name: string;
  category: 'DevOps' | 'Productivity' | 'Infrastructure';
  description: string;
  /** Redirect URI pattern with a {baseUrl} placeholder for the target app's own URL. */
  redirectUriPattern: string;
  clientType: 'CONFIDENTIAL' | 'PUBLIC';
  grantTypes: string[];
  /** Short, numbered setup steps on the target application's side. */
  setupInstructions: string[];
}

/**
 * A starter catalog of pre-configured OIDC client templates for popular
 * self-hosted applications. Redirect URI patterns and setup steps reflect
 * each application's generic/OpenID-Connect login mechanism as of the
 * versions commonly deployed today — always double-check against the
 * specific version you're running, since third-party apps change these
 * paths between releases.
 *
 * Contribute more templates by adding an entry here — see CONTRIBUTING.md.
 */
export const CLIENT_TEMPLATES: ClientTemplate[] = [
  {
    id: 'grafana',
    name: 'Grafana',
    category: 'DevOps',
    description: 'Dashboards and observability platform.',
    redirectUriPattern: '{baseUrl}/login/generic_oauth',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In grafana.ini (or via GF_AUTH_GENERIC_OAUTH_* env vars), set auth.generic_oauth.enabled = true.',
      'Set client_id and client_secret to the values from this client.',
      'Set auth_url, token_url, and api_url to your Idenplane realm\'s OIDC discovery endpoints.',
      'Restart Grafana and look for the "Sign in with Idenplane" option on the login page.',
    ],
  },
  {
    id: 'gitlab',
    name: 'GitLab (self-hosted)',
    category: 'DevOps',
    description: 'Git hosting, CI/CD, and DevOps platform.',
    redirectUriPattern: '{baseUrl}/users/auth/openid_connect/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In gitlab.rb, add an openid_connect entry under gitlab_rails[\'omniauth_providers\'].',
      'Set client_id, client_secret, and issuer to this client and your realm\'s issuer URL.',
      'Set gitlab_rails[\'omniauth_allow_single_sign_on\'] to [\'openid_connect\'] if you want auto-provisioning.',
      'Run gitlab-ctl reconfigure and restart.',
    ],
  },
  {
    id: 'argocd',
    name: 'Argo CD',
    category: 'DevOps',
    description: 'Declarative GitOps continuous delivery for Kubernetes.',
    redirectUriPattern: '{baseUrl}/auth/callback',
    clientType: 'PUBLIC',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Edit the argocd-cm ConfigMap and add an oidc.config block with this client\'s clientID and your realm\'s issuer.',
      'Argo CD\'s dex-free OIDC mode expects a public client (no client secret) using PKCE.',
      'Map realm roles to Argo CD RBAC via the requestedIDTokenClaims / groups claim if you use group-based policies.',
      'Restart the argocd-server pod to pick up the ConfigMap change.',
    ],
  },
  {
    id: 'portainer',
    name: 'Portainer',
    category: 'Infrastructure',
    description: 'Container management UI for Docker and Kubernetes.',
    redirectUriPattern: '{baseUrl}',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In Portainer, go to Settings → Authentication → OAuth.',
      'Choose "Custom" as the provider and fill in Client ID / Client Secret from this client.',
      'Set the Authorization, Access Token, and Resource URLs from your realm\'s OIDC discovery document.',
      'Set the redirect URI shown above exactly as Portainer\'s own base URL (it does not use a dedicated callback path).',
    ],
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    category: 'Productivity',
    description: 'Self-hosted file sync, sharing, and collaboration.',
    redirectUriPattern: '{baseUrl}/apps/user_oidc/code',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Install and enable the "OpenID Connect user backend" (user_oidc) app from the Nextcloud app store.',
      'Under Settings → OpenID Connect, add a new provider with this client\'s ID/secret and your realm\'s discovery URL.',
      'The exact callback path can differ by user_oidc version — check the app\'s own settings page, which usually displays the redirect URI to register.',
    ],
  },
  {
    id: 'outline',
    name: 'Outline',
    category: 'Productivity',
    description: 'Team knowledge base and wiki.',
    redirectUriPattern: '{baseUrl}/auth/oidc.callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Set the OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_AUTH_URI / OIDC_TOKEN_URI / OIDC_USERINFO_URI environment variables.',
      'Set OIDC_DISPLAY_NAME to whatever label you want on Outline\'s login button.',
      'Restart Outline for the environment changes to take effect.',
    ],
  },
  {
    id: 'mattermost',
    name: 'Mattermost',
    category: 'Productivity',
    description: 'Team messaging and collaboration platform.',
    redirectUriPattern: '{baseUrl}/signup/openid/complete',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In System Console → Authentication → OpenID Connect, enable it and select "OpenID Connect" as the type.',
      'Fill in Client ID, Client Secret, Discovery Endpoint (your realm\'s .well-known/openid-configuration URL).',
      'Save, then confirm the "Sign in with OpenID Connect" button appears on the login page.',
    ],
  },
  {
    id: 'pgadmin',
    name: 'pgAdmin',
    category: 'Infrastructure',
    description: 'Web-based PostgreSQL administration.',
    redirectUriPattern: '{baseUrl}/oauth2/authorize',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In config_local.py, set AUTHENTICATION_SOURCES to include "oauth2".',
      'Add an OAUTH2_CONFIG entry with this client\'s ID/secret and your realm\'s authorization/token/userinfo endpoints.',
      'Restart pgAdmin; an "Login with <OAUTH2_NAME>" button appears on the login page.',
    ],
  },
];
