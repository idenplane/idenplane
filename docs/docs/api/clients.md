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
| `redirectUris` | string[] | No | Allowed redirect URIs |
| `webOrigins` | string[] | No | Allowed CORS origins (`*` is refused) |
| `grantTypes` | string[] | No | Allowed grants: `authorization_code` (default), `refresh_token`, `client_credentials`, `password`, `urn:ietf:params:oauth:grant-type:device_code` |
| `requireConsent` | boolean | No | Require user consent (default: false) |
| `backchannelLogoutUri` | string | No | OIDC back-channel logout URL |
| `backchannelLogoutSessionRequired` | boolean | No | Include `sid` in logout tokens |
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
  "redirectUris": "string[] (URLs)",
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
