export interface ClientTemplate {
  id: string;
  name: string;
  category: 'DevOps' | 'Productivity' | 'Infrastructure' | 'Media' | 'Communication';
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
  {
    id: 'jenkins',
    name: 'Jenkins',
    category: 'DevOps',
    description: 'Automation server for CI/CD pipelines.',
    redirectUriPattern: '{baseUrl}/securityRealm/finishLogin',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Install the "OpenId Connect Authentication" plugin from the Jenkins plugin manager.',
      'In Manage Jenkins → Security, choose "Login with Openid Connect" and fill in Client ID/Secret.',
      'Set the well-known configuration endpoint to your realm\'s .well-known/openid-configuration URL.',
      'Restart Jenkins and confirm the login page now offers OpenID Connect sign-in.',
    ],
  },
  {
    id: 'gitea',
    name: 'Gitea',
    category: 'DevOps',
    description: 'Lightweight self-hosted Git service.',
    redirectUriPattern: '{baseUrl}/user/oauth2/idenplane/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In Site Administration → Identity Providers, add a new "OAuth2" source of type "OpenID Connect".',
      'Name the provider "idenplane" (the redirect URI above assumes this exact name — a different name changes the callback path).',
      'Fill in Client ID/Secret and the OpenID Connect Auto Discovery URL from your realm.',
    ],
  },
  {
    id: 'forgejo',
    name: 'Forgejo',
    category: 'DevOps',
    description: 'Community-driven fork of Gitea.',
    redirectUriPattern: '{baseUrl}/user/oauth2/idenplane/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Forgejo inherited Gitea\'s auth UI: Site Administration → Identity Providers → add an "OpenID Connect" source.',
      'Name the provider "idenplane" (the redirect URI above assumes this exact name).',
      'Fill in Client ID/Secret and the OpenID Connect Auto Discovery URL from your realm.',
    ],
  },
  {
    id: 'harbor',
    name: 'Harbor',
    category: 'Infrastructure',
    description: 'Container image registry with vulnerability scanning.',
    redirectUriPattern: '{baseUrl}/c/oidc/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In Administration → Configuration → Authentication, set Auth Mode to "OIDC".',
      'Fill in the OIDC Provider Name, Endpoint (your realm\'s issuer URL), Client ID and Secret.',
      'Enable "Verify Certificate" only if your realm is served over a certificate Harbor already trusts.',
    ],
  },
  {
    id: 'rancher',
    name: 'Rancher',
    category: 'Infrastructure',
    description: 'Multi-cluster Kubernetes management platform.',
    redirectUriPattern: '{baseUrl}/verify-auth',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In Users & Authentication → Auth Provider, choose "OIDC" (generic).',
      'Fill in the Issuer URL, Client ID, and Client Secret from your realm and this client.',
      'Map a realm role to Rancher\'s admin group if you want existing users to keep cluster-admin access after enabling OIDC.',
    ],
  },
  {
    id: 'vault',
    name: 'HashiCorp Vault',
    category: 'Infrastructure',
    description: 'Secrets management and encryption as a service.',
    redirectUriPattern: '{baseUrl}/ui/vault/auth/oidc/oidc/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Enable the auth method: vault auth enable oidc.',
      'Configure it with vault write auth/oidc/config oidc_discovery_url=<realm issuer> oidc_client_id=<id> oidc_client_secret=<secret>.',
      'Add the redirect URI above to allowed_redirect_uris in the same config command.',
      'Create a role (vault write auth/oidc/role/...) mapping realm claims to Vault policies.',
    ],
  },
  {
    id: 'sonarqube',
    name: 'SonarQube',
    category: 'DevOps',
    description: 'Static code analysis and quality gate server.',
    redirectUriPattern: '{baseUrl}/oauth2/callback/oidc',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'OIDC login availability depends on your SonarQube edition — check your edition\'s docs before configuring.',
      'Under Administration → Configuration → General → Authentication → OIDC, fill in Issuer URI, Client ID, and Client Secret.',
      'Enable "Allow users to sign up" if you want first-login accounts created automatically.',
    ],
  },
  {
    id: 'bookstack',
    name: 'BookStack',
    category: 'Productivity',
    description: 'Self-hosted wiki and documentation platform.',
    redirectUriPattern: '{baseUrl}/oidc/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Set AUTH_METHOD=oidc in BookStack\'s .env file.',
      'Set OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_ISSUER to this client\'s values and your realm\'s issuer URL.',
      'Set OIDC_DISPLAY_NAME_CLAIMS and OIDC_END_SESSION_ENDPOINT as needed, then clear BookStack\'s config cache.',
    ],
  },
  {
    id: 'rocketchat',
    name: 'Rocket.Chat',
    category: 'Communication',
    description: 'Self-hosted team chat platform.',
    redirectUriPattern: '{baseUrl}/_oauth/idenplane',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In Administration → OAuth, add a new custom OAuth service named "idenplane" (the redirect URI above assumes this exact name).',
      'Fill in Client ID/Secret and the Authorize/Token/Identity URLs from your realm\'s OIDC discovery document.',
      'Set the "Identity Token Sent Via" field to match how your realm returns the access token (header is the common default).',
    ],
  },
  {
    id: 'coder',
    name: 'Coder',
    category: 'DevOps',
    description: 'Self-hosted remote development environments.',
    redirectUriPattern: '{baseUrl}/api/v2/users/oidc/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Set CODER_OIDC_ISSUER_URL, CODER_OIDC_CLIENT_ID, and CODER_OIDC_CLIENT_SECRET as server environment variables.',
      'Restart the Coder server; the login page will show an OpenID Connect option automatically once these are set.',
      'Optionally set CODER_OIDC_GROUP_MAPPING to translate realm roles into Coder groups.',
    ],
  },
  {
    id: 'n8n',
    name: 'n8n',
    category: 'DevOps',
    description: 'Workflow automation platform.',
    redirectUriPattern: '{baseUrl}/rest/sso/oidc/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'SSO is an Enterprise-tier n8n feature — confirm your license includes it before configuring.',
      'In the SSO settings screen, choose "OIDC" and fill in Client ID, Client Secret, and Discovery Endpoint.',
      'Save and test with a single account before rolling out to the full team.',
    ],
  },
  {
    id: 'minio-console',
    name: 'MinIO Console',
    category: 'Infrastructure',
    description: 'S3-compatible object storage web console.',
    redirectUriPattern: '{baseUrl}/oauth_callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Set the MINIO_IDENTITY_OPENID_CONFIG_URL, MINIO_IDENTITY_OPENID_CLIENT_ID, and MINIO_IDENTITY_OPENID_CLIENT_SECRET environment variables.',
      'Set MINIO_IDENTITY_OPENID_REDIRECT_URI to the value above and restart the MinIO server.',
      'Map realm roles to MinIO policies via MINIO_IDENTITY_OPENID_CLAIM_NAME if you use claim-based policy assignment.',
    ],
  },
  {
    id: 'zammad',
    name: 'Zammad',
    category: 'Productivity',
    description: 'Self-hosted customer support / helpdesk system.',
    redirectUriPattern: '{baseUrl}/auth/generic_oauth/callback',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Generic OIDC login is a newer Zammad feature — confirm your version supports it before configuring.',
      'In System → Security → Third-Party Applications, enable "Generic OIDC" and fill in Client ID/Secret and the discovery URL.',
      'Confirm the "Sign in with OIDC" button appears on the login page after saving.',
    ],
  },
  {
    id: 'immich',
    name: 'Immich',
    category: 'Media',
    description: 'Self-hosted photo and video backup.',
    redirectUriPattern: '{baseUrl}/auth/login',
    clientType: 'PUBLIC',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'In Administration → Settings → OAuth, enable OAuth and fill in the Issuer URL and this client\'s Client ID.',
      'Immich\'s OAuth login is a public client (PKCE, no client secret) by default — confirm this matches your realm\'s client type.',
      'If you also use the mobile app, additionally register the app.immich://oauth-callback redirect URI in this client.',
    ],
  },
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    category: 'Media',
    description: 'Self-hosted media server.',
    redirectUriPattern: '{baseUrl}/sso/OID/redirect/idenplane',
    clientType: 'CONFIDENTIAL',
    grantTypes: ['authorization_code', 'refresh_token'],
    setupInstructions: [
      'Jellyfin has no built-in OIDC support — install the community "SSO-Auth" plugin from the plugin catalog first.',
      'Under the plugin\'s config page, add a provider named "idenplane" (the redirect URI above assumes this exact name).',
      'Fill in the OID Endpoint, Client ID, and Client Secret, then map realm roles/groups to Jellyfin users as needed.',
    ],
  },
];
