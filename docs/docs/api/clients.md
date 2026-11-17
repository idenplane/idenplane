---
id: clients
title: Clients API
description: Client application management endpoints for Idenplane
---

# Clients API

The Clients API provides endpoints for managing OAuth 2.0 / OpenID Connect client applications within a realm.

## Base URL

```
/admin/realms/:realmName/clients
```

## Authentication

All client endpoints require API key authentication:

```bash
-H "x-admin-api-key: your-api-key-here"
```

## List Clients

```
GET /admin/realms/:realmName/clients
```

Returns all clients in the realm as a JSON array. Client secrets are never returned.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/clients" \
  -H "x-admin-api-key: your-api-key-here"
```

### Response

```json
[
  {
    "id": "client-uuid-123",
    "clientId": "my-web-app",
    "clientType": "CONFIDENTIAL",
    "name": "My Web Application",
    "description": "Main web application client",
    "enabled": true,
    "redirectUris": [
      "https://myapp.com/callback",
      "https://myapp.com/silent-renew"
    ],
    "webOrigins": [
      "https://myapp.com"
    ],
    "grantTypes": ["authorization_code", "refresh_token", "client_credentials"],
    "requireConsent": true,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

Each entry has the fields of the [client object](#client-object-schema); the example is shortened.

## Create Client

```
POST /admin/realms/:realmName/clients
```

Creates a new OAuth client application.

### Request Body

| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `clientId` | string | Yes | Unique client identifier (at least 2 characters) |
| `name` | string | No | Human-readable name |
| `description` | string | No | Client description |
| `clientType` | string | No | `CONFIDENTIAL` (default) or `PUBLIC` (no secret; PKCE required) |
| `publicClient` | boolean | No | Shorthand for `clientType: "PUBLIC"`; ignored when `clientType` is set |
| `enabled` | boolean | No | Whether client is enabled (default: true) |
| `redirectUris` | string[] | No | Allowed redirect URIs, matched exactly. See [Redirect URI matching](#redirect-uri-matching). |
| `postLogoutRedirectUris` | string[] | No | Allowed `post_logout_redirect_uri` values, matched exactly. Falls back to `redirectUris` when empty. |
| `allowInsecureWildcardRedirectUris` | boolean | No | **Insecure, for migration only.** Lets an entry ending in `/*` match any path below it, as before 0.11.0. Default `false`. |
| `webOrigins` | string[] | No | Allowed CORS origins (`*` is refused) |
| `grantTypes` | string[] | No | Allowed grants: `authorization_code` (default), `refresh_token`, `client_credentials`, `password`, `urn:ietf:params:oauth:grant-type:device_code` |
| `requireConsent` | boolean | No | Require user consent (default: false) |
| `backchannelLogoutUri` | string | No | OIDC back-channel logout URL: receives a logout token when a session this client holds ends (sign-out, admin sign-out, credential change, idle timeout). See [Back-Channel Logout](../guides/authentication.mdx#back-channel-logout) |
| `backchannelLogoutSessionRequired` | boolean | No | The client needs `sid` in logout tokens (default `true`). When `false`, signing a user out everywhere sends it one `sub`-only token per user instead of one per session |
| `requiredAcr` | string | No | Minimum ACR for this client (step-up) |
| `stepUpCacheDuration` | integer | No | Seconds a step-up stays valid |
| `tokenEndpointAuthMethod` | string | No | `client_secret_basic`, `client_secret_post`, `tls_client_auth`, `self_signed_tls_client_auth` or `none` |

The mTLS settings (`tlsClientAuth*`, `tlsClientCertificateBoundAccessTokens`) are described in [mTLS client authentication](../guides/mtls-client-auth.mdx). Token lifetimes are realm settings, not client settings. Any other field is rejected with `400`.

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/master/clients" \
  -H "x-admin-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "my-mobile-app",
    "name": "My Mobile Application",
    "description": "iOS and Android mobile app",
    "publicClient": true,
    "redirectUris": [
      "com.myapp://callback"
    ],
    "grantTypes": ["authorization_code", "refresh_token"]
  }'
```

### Response

```json
{
  "id": "client-uuid-789",
  "realmId": "realm-uuid-1",
  "clientId": "my-mobile-app",
  "clientType": "PUBLIC",
  "name": "My Mobile Application",
  "description": "iOS and Android mobile app",
  "enabled": true,
  "redirectUris": ["com.myapp://callback"],
  "postLogoutRedirectUris": [],
  "webOrigins": [],
  "grantTypes": ["authorization_code", "refresh_token"],
  "requireConsent": false,
  "backchannelLogoutUri": null,
  "backchannelLogoutSessionRequired": false,
  "serviceAccountUserId": null,
  "requiredAcr": null,
  "stepUpCacheDuration": 900,
  "tokenEndpointAuthMethod": "none",
  "createdAt": "2024-02-01T10:00:00Z",
  "updatedAt": "2024-02-01T10:00:00Z"
}
```

For a confidential client the response also carries the generated `clientSecret`, with `"secretDisplayedOnce": true` and a `secretWarning`. This is the only time the secret is shown. A confidential client with `client_credentials` in `grantTypes` also gets a service account user.

### Redirect URI matching

Since 0.11.0 a `redirect_uri` (and a `post_logout_redirect_uri`) must equal one of the client's registered values **character for character**, as the OAuth 2.0 Security BCP (RFC 9700 §2.1) and OAuth 2.1 require:

- Nothing is normalised. A different case in the scheme or host, a trailing slash, a `..` or `.` segment, a percent-encoded character or a query string that is not registered all fail.
- A redirect URI with a fragment (`#...`) is always refused, and cannot be registered (RFC 6749 §3.1.2).
- **Loopback redirect URIs of native apps match on any port** (RFC 8252 §7.3): `http://127.0.0.1/callback` registered allows `http://127.0.0.1:51234/callback`, and the same for `http://[::1]/...`. Only the port may differ, only for `http`, and only for these IP literals: `localhost` gets no such exception (RFC 8252 §8.3).
- A `*` is refused at registration, unless the client has `allowInsecureWildcardRedirectUris`.

**`allowInsecureWildcardRedirectUris` is insecure.** With it, a registered `https://app.example.com/app/*` matches any path below `/app/` (and `https://app.example.com/app` itself), so any page there, including an open redirect or user-controlled content, can receive the authorization code. Idenplane still refuses fragments, other origins, `..` and `.` segments and encoded `/`, `.` or `\` in the path of such a match, but that does not make it safe. It exists so that clients registered with wildcards before 0.11.0 keep working while they are moved to exact URIs: the 0.11.0 upgrade turns it on for every client that already had a `/*` entry, and `GET /admin/upgrade/health` lists those clients in the `wildcard_redirect_uris` warning. To move a client off it, register each exact callback URL your application sends, then set `allowInsecureWildcardRedirectUris` to `false` in the same update:

```bash
curl -X PUT "http://localhost:3000/admin/realms/my-realm/clients/my-web-app" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "redirectUris": ["https://myapp.com/callback", "https://myapp.com/silent-renew"],
    "allowInsecureWildcardRedirectUris": false
  }'
```

Turning the option off while a `/*` entry is still registered is refused with `400`, because that entry would silently never match.

Web origins (`webOrigins`, CORS) are unchanged: they are whole origins, compared exactly, and `*` is refused.

## Get Client

```
GET /admin/realms/:realmName/clients/:clientId
```

Returns a single client. `:clientId` is the OAuth `clientId` or the client's `id` (UUID).

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/clients/client-uuid-789" \
  -H "x-admin-api-key: your-api-key-here"
```

### Response

```json
{
  "id": "client-uuid-789",
  "realmId": "realm-uuid-1",
  "clientId": "my-mobile-app",
  "clientType": "PUBLIC",
  "name": "My Mobile Application",
  "description": "iOS and Android mobile app",
  "enabled": true,
  "redirectUris": ["com.myapp://callback"],
  "postLogoutRedirectUris": [],
  "webOrigins": [],
  "grantTypes": ["authorization_code", "refresh_token"],
  "requireConsent": false,
  "backchannelLogoutUri": null,
  "backchannelLogoutSessionRequired": false,
  "serviceAccountUserId": null,
  "requiredAcr": null,
  "stepUpCacheDuration": 900,
  "tokenEndpointAuthMethod": "none",
  "createdAt": "2024-02-01T10:00:00Z",
  "updatedAt": "2024-02-01T10:00:00Z"
}
```

## Update Client

```
PUT /admin/realms/:realmName/clients/:clientId
```

Updates an existing client. Only the fields you send change: `PUT` and `PATCH` behave the same. `clientId` cannot be changed; sending it is rejected with `400`.

### Request Example

```bash
curl -X PUT "http://localhost:3000/admin/realms/master/clients/client-uuid-789" \
  -H "x-admin-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Mobile Application Updated",
    "description": "Updated description",
    "redirectUris": [
      "com.myapp://callback",
      "com.myapp://another-callback"
    ]
  }'
```

## Partial Update Client

```
PATCH /admin/realms/:realmName/clients/:clientId
```

Partially updates a client. Only provided fields are modified.

```bash
curl -X PATCH "http://localhost:3000/admin/realms/master/clients/client-uuid-789" \
  -H "x-admin-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated via PATCH"
  }'
```

## Delete Client

```
DELETE /admin/realms/:realmName/clients/:clientId
```

Permanently deletes a client and all associated data including client credentials.

### Request Example

```bash
curl -X DELETE "http://localhost:3000/admin/realms/master/clients/client-uuid-789" \
  -H "x-admin-api-key: your-api-key-here"
```

### Response

Returns HTTP 204 No Content on success.

## Regenerate Client Secret

```
POST /admin/realms/:realmName/clients/:clientId/regenerate-secret
```

Generates a new client secret for confidential clients. The old secret is invalidated immediately.

:::warning Important
When regenerating a secret, immediately update your application's configuration with the new secret. There is no grace period.
:::

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/master/clients/client-uuid-123/regenerate-secret" \
  -H "x-admin-api-key: your-api-key-here"
```

### Response

```json
{
  "clientId": "my-web-app",
  "clientSecret": "b3f1c2...64 hex characters...9e0a",
  "secretWarning": "Store this secret securely. It will not be shown again."
}
```

## Get Service Account

```
GET /admin/realms/:realmName/clients/:clientId/service-account-user
```

Returns the service account user of a client. A confidential client gets one when it is created with `client_credentials` in `grantTypes`; otherwise this returns `404`. Assign roles to this user to grant them to the client.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/clients/client-uuid-123/service-account-user" \
  -H "x-admin-api-key: your-api-key-here"
```

### Response

```json
{
  "id": "service-account-uuid-456",
  "username": "service-account-my-web-app",
  "enabled": true,
  "createdAt": "2024-01-01T00:00:00Z",
  "userRoles": []
}
```

## Client Object Schema

```json
{
  "id": "string (UUID)",
  "clientId": "string",
  "name": "string",
  "description": "string",
  "enabled": "boolean",
  "realmId": "string (UUID)",
  "clientType": "string (CONFIDENTIAL|PUBLIC)",
  "redirectUris": "string[] (URLs, matched exactly)",
  "postLogoutRedirectUris": "string[] (URLs, matched exactly)",
  "allowInsecureWildcardRedirectUris": "boolean (insecure, legacy; default false)",
  "webOrigins": "string[] (origins)",
  "grantTypes": "string[]",
  "requireConsent": "boolean",
  "backchannelLogoutUri": "string | null",
  "backchannelLogoutSessionRequired": "boolean",
  "serviceAccountUserId": "string (UUID) | null",
  "requiredAcr": "string | null",
  "stepUpCacheDuration": "integer (seconds)",
  "tokenEndpointAuthMethod": "string | null",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `ValidationError` | Invalid request body or parameters |
| 401 | `Unauthorized` | Missing or invalid API key |
| 404 | `NotFound` | Client not found |
| 409 | `Conflict` | Client ID already exists |

## Supported Flows

The flows a client may use are the entries of its `grantTypes`:

| Flow | `grantTypes` entry | Description |
|------|--------------|-------------|
| Authorization Code + PKCE | `authorization_code` | Recommended for web and mobile apps; PKCE is required for public clients |
| Client Credentials | `client_credentials` | Machine-to-machine authentication (confidential clients) |
| Resource Owner Password | `password` | Deprecated, not recommended |
| Refresh Token | `refresh_token` | Refresh expired access tokens |
| Device Authorization | `urn:ietf:params:oauth:grant-type:device_code` | Input-constrained devices |

The implicit flow is not supported. SAML service providers are a separate resource: `/admin/realms/:realmName/saml-service-providers`.
