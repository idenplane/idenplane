---
id: clients
title: Clients API
description: Client application management endpoints for AuthMe
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
-H "X-API-Key: your-api-key-here"
```

## List Clients

```
GET /admin/realms/:realmName/clients
```

Returns all clients in the realm.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/clients" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "data": [
    {
      "id": "client-uuid-123",
      "clientId": "my-web-app",
      "name": "My Web Application",
      "description": "Main web application client",
      "enabled": true,
      "rootUrl": "https://myapp.com",
      "redirectUris": [
        "https://myapp.com/callback",
        "https://myapp.com/silent-renew"
      ],
      "webOrigins": [
        "https://myapp.com"
      ],
      "protocol": "openid-connect",
      "accessTokenLifespan": 300,
      "publicClient": false,
      "consentRequired": true,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

## Create Client

```
POST /admin/realms/:realmName/clients
```

Creates a new OAuth client application.

### Request Body

| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `clientId` | string | Yes | Unique client identifier |
| `name` | string | Yes | Human-readable name |
| `description` | string | No | Client description |
| `enabled` | boolean | No | Whether client is enabled (default: true) |
| `rootUrl` | string | No | Application root URL |
| `baseUrl` | string | No | Default URL within the application |
| `redirectUris` | string[] | No | Allowed redirect URIs |
| `webOrigins` | string[] | No | Allowed CORS origins |
| `protocol` | string | No | Protocol (default: "openid-connect") |
| `publicClient` | boolean | No | Public client (no client secret) |
| `consentRequired` | boolean | No | Require user consent |
| `standardFlowEnabled` | boolean | No | Enable authorization code flow |
| `implicitFlowEnabled` | boolean | No | Enable implicit flow (deprecated) |
| `directAccessGrantsEnabled` | boolean | No | Enable resource owner password grant |
| `serviceAccountsEnabled` | boolean | No | Enable service accounts |
| `accessTokenLifespan` | integer | No | Access token lifetime in seconds |
| `refreshTokenLifespan` | integer | No | Refresh token lifetime in seconds |

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/master/clients" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "my-mobile-app",
    "name": "My Mobile Application",
    "description": "iOS and Android mobile app",
    "publicClient": true,
    "redirectUris": [
      "com.myapp://callback"
    ],
    "standardFlowEnabled": true,
    "serviceAccountsEnabled": false
  }'
```

### Response

```json
{
  "id": "client-uuid-789",
  "clientId": "my-mobile-app",
  "name": "My Mobile Application",
  "description": "iOS and Android mobile app",
  "enabled": true,
  "publicClient": true,
  "redirectUris": ["com.myapp://callback"],
  "protocol": "openid-connect",
  "standardFlowEnabled": true,
  "serviceAccountsEnabled": false,
  "createdAt": "2024-02-01T10:00:00Z"
}
```

## Get Client

```
GET /admin/realms/:realmName/clients/:clientId
```

Returns a single client by ID.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/clients/client-uuid-789" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "id": "client-uuid-789",
  "clientId": "my-mobile-app",
  "name": "My Mobile Application",
  "description": "iOS and Android mobile app",
  "enabled": true,
  "rootUrl": null,
  "baseUrl": null,
  "redirectUris": ["com.myapp://callback"],
  "webOrigins": [],
  "protocol": "openid-connect",
  "publicClient": true,
  "consentRequired": false,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "accessTokenLifespan": 300,
  "refreshTokenLifespan": 1800,
  "createdAt": "2024-02-01T10:00:00Z",
  "updatedAt": "2024-02-01T10:00:00Z"
}
```

## Update Client

```
PUT /admin/realms/:realmName/clients/:clientId
```

Updates an existing client. Replaces all fields.

### Request Example

```bash
curl -X PUT "http://localhost:3000/admin/realms/master/clients/client-uuid-789" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "my-mobile-app",
    "name": "My Mobile Application Updated",
    "description": "Updated description",
    "enabled": true,
    "publicClient": true,
    "redirectUris": [
      "com.myapp://callback",
      "com.myapp://another-callback"
    ],
    "standardFlowEnabled": true
  }'
```

## Partial Update Client

```
PATCH /admin/realms/:realmName/clients/:clientId
```

Partially updates a client. Only provided fields are modified.

```bash
curl -X PATCH "http://localhost:3000/admin/realms/master/clients/client-uuid-789" \
  -H "X-API-Key: your-api-key-here" \
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
  -H "X-API-Key: your-api-key-here"
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
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "id": "client-uuid-123",
  "clientId": "my-web-app",
  "name": "My Web Application",
  "secret": "new-generated-secret-value-here",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-02-20T15:30:00Z"
}
```

## Get Service Account

```
GET /admin/realms/:realmName/clients/:clientId/service-account-user
```

Returns the service account user associated with a client. This user can be used to grant roles and permissions to the service account.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/clients/client-uuid-123/service-account-user" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "id": "service-account-uuid-456",
  "username": "service-account-my-web-app",
  "email": "sa-my-web-app@realm.local",
  "firstName": "Service",
  "lastName": "Account",
  "enabled": true,
  "emailVerified": true,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z",
  "attributes": {
    "clientId": ["client-uuid-123"]
  }
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
  "rootUrl": "string (URL)",
  "baseUrl": "string (URL)",
  "redirectUris": "string[] (URLs)",
  "webOrigins": "string[] (origins)",
  "protocol": "string (openid-connect|saml)",
  "publicClient": "boolean",
  "consentRequired": "boolean",
  "standardFlowEnabled": "boolean",
  "implicitFlowEnabled": "boolean",
  "directAccessGrantsEnabled": "boolean",
  "serviceAccountsEnabled": "boolean",
  "accessTokenLifespan": "integer (seconds)",
  "refreshTokenLifespan": "integer (seconds)",
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

| Flow | Enabled Flag | Description |
|------|--------------|-------------|
| Authorization Code + PKCE | `standardFlowEnabled` | Recommended for web and mobile apps |
| Implicit | `implicitFlowEnabled` | Deprecated, use Authorization Code + PKCE |
| Client Credentials | `directAccessGrantsEnabled` | Machine-to-machine authentication |
| Resource Owner Password | Direct Access Grants | Deprecated, not recommended |
| Refresh Token | (automatic) | Refresh expired access tokens |
