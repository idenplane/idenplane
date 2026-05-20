---
id: realms
title: Realms API
description: Realm administration endpoints for Idenplane
---

# Realms API

The Realms API provides endpoints for managing realms (multi-tenancy units) and realm-level configuration. Realms are isolated namespaces for users, clients, and configuration.

## Base URL

```
/admin/realms
```

## Authentication

Most realm endpoints require super-admin role access:

```bash
-H "X-API-Key: your-api-key-here"
```

Realms with `super-admin` role can manage all realms. Regular admin users can only manage their assigned realm.

## List Realms

```
GET /admin/realms
```

Returns all realms in the system.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "data": [
    {
      "id": "realm-uuid-123",
      "name": "master",
      "displayName": "Master Realm",
      "displayNameHtml": "<b>Master Realm</b>",
      "enabled": true,
      "registrationAllowed": true,
      "loginWithEmailAllowed": true,
      "duplicateEmailsAllowed": false,
      "passwordPolicy": "length(8) and specialChar(1) and digit(1)",
      "accessTokenLifespan": 300,
      "refreshTokenLifespan": 1800,
      "ssoSessionIdleTimeout": 1800,
      "ssoSessionMaxLifespan": 36000,
      "offlineSessionIdleTimeout": 2592000,
      "createdAt": "2023-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "realm-uuid-456",
      "name": "acme-corp",
      "displayName": "ACME Corporation",
      "displayNameHtml": "<b>ACME Corporation</b>",
      "enabled": true,
      "registrationAllowed": false,
      "loginWithEmailAllowed": true,
      "duplicateEmailsAllowed": false,
      "passwordPolicy": "length(12) and specialChar(2) and upperChar(1)",
      "accessTokenLifespan": 600,
      "refreshTokenLifespan": 3600,
      "ssoSessionIdleTimeout": 3600,
      "ssoSessionMaxLifespan": 86400,
      "offlineSessionIdleTimeout": 604800,
      "createdAt": "2024-01-15T00:00:00Z",
      "updatedAt": "2024-01-15T00:00:00Z"
    }
  ]
}
```

## Create Realm

```
POST /admin/realms
```

Creates a new realm. Requires `super-admin` role.

### Request Body

| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `name` | string | Yes | Unique realm name (lowercase, no spaces) |
| `displayName` | string | No | Human-readable name |
| `displayNameHtml` | string | No | HTML-formatted display name |
| `enabled` | boolean | No | Enable realm (default: true) |
| `registrationAllowed` | boolean | No | Allow user self-registration |
| `loginWithEmailAllowed` | boolean | No | Allow login with email as username |
| `duplicateEmailsAllowed` | boolean | No | Allow duplicate emails across users |
| `passwordPolicy` | string | No | Password policy configuration |
| `accessTokenLifespan` | integer | No | Access token lifetime in seconds |
| `refreshTokenLifespan` | integer | No | Refresh token lifetime in seconds |
| `ssoSessionIdleTimeout` | integer | No | SSO session idle timeout |
| `ssoSessionMaxLifespan` | integer | No | Maximum SSO session lifetime |
| `offlineSessionIdleTimeout` | integer | No | Offline session idle timeout |
| `bruteForceProtected` | boolean | No | Enable brute force protection |
| `maxLoginFailures` | integer | No | Max login failures before lockout |
| `failureResetTime` | integer | No | Lockout reset time in seconds |
| `smtpConfig` | object | No | SMTP configuration |
| `theme` | object | No | Theme configuration |

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "partner-portal",
    "displayName": "Partner Portal",
    "registrationAllowed": false,
    "loginWithEmailAllowed": true,
    "passwordPolicy": "length(10) and specialChar(1)",
    "accessTokenLifespan": 600,
    "bruteForceProtected": true,
    "maxLoginFailures": 5
  }'
```

### Response

```json
{
  "id": "realm-uuid-789",
  "name": "partner-portal",
  "displayName": "Partner Portal",
  "enabled": true,
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "passwordPolicy": "length(10) and specialChar(1)",
  "accessTokenLifespan": 600,
  "refreshTokenLifespan": 1800,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "offlineSessionIdleTimeout": 2592000,
  "bruteForceProtected": true,
  "maxLoginFailures": 5,
  "failureResetTime": 300,
  "createdAt": "2024-02-01T10:00:00Z",
  "updatedAt": "2024-02-01T10:00:00Z"
}
```

## Get Realm

```
GET /admin/realms/:realmName
```

Returns a single realm by name.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/partner-portal" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "id": "realm-uuid-789",
  "name": "partner-portal",
  "displayName": "Partner Portal",
  "displayNameHtml": "<b>Partner Portal</b>",
  "enabled": true,
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "passwordPolicy": "length(10) and specialChar(1)",
  "accessTokenLifespan": 600,
  "refreshTokenLifespan": 1800,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "offlineSessionIdleTimeout": 2592000,
  "bruteForceProtected": true,
  "maxLoginFailures": 5,
  "failureResetTime": 300,
  "createdAt": "2024-02-01T10:00:00Z",
  "updatedAt": "2024-02-01T10:00:00Z"
}
```

## Update Realm

```
PUT /admin/realms/:realmName
```

Updates an existing realm. Requires `super-admin` role. Replaces all configuration.

### Request Example

```bash
curl -X PUT "http://localhost:3000/admin/realms/partner-portal" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "partner-portal",
    "displayName": "Partner Portal Updated",
    "enabled": true,
    "registrationAllowed": false,
    "loginWithEmailAllowed": true,
    "passwordPolicy": "length(12) and specialChar(2)"
  }'
```

## Partial Update Realm

```
PATCH /admin/realms/:realmName
```

Partially updates a realm. Only provided fields are modified.

### Request Example

```bash
curl -X PATCH "http://localhost:3000/admin/realms/partner-portal" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "registrationAllowed": true,
    "passwordPolicy": "length(8)"
  }'
```

## Delete Realm

```
DELETE /admin/realms/:realmName
```

Permanently deletes a realm and all associated data (users, clients, roles, etc.). Requires `super-admin` role.

:::warning Important
This action is irreversible. Ensure you have exported any important data before deleting a realm.
:::

### Request Example

```bash
curl -X DELETE "http://localhost:3000/admin/realms/partner-portal" \
  -H "X-API-Key: your-api-key-here"
```

### Response

Returns HTTP 204 No Content on success.

## Export Realm

```
GET /admin/realms/:realmName/export
```

Exports realm configuration to JSON. Can optionally include users and secrets.

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `includeUsers` | false | Include users in export |
| `includeSecrets` | false | Include client secrets in export |

### Request Example

```bash
# Export realm configuration only
curl -X GET "http://localhost:3000/admin/realms/partner-portal/export" \
  -H "X-API-Key: your-api-key-here"

# Export with users (no secrets for security)
curl -X GET "http://localhost:3000/admin/realms/partner-portal/export?includeUsers=true" \
  -H "X-API-Key: your-api-key-here"

# Export with users and secrets
curl -X GET "http://localhost:3000/admin/realms/partner-portal/export?includeUsers=true&includeSecrets=true" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "realm": {
    "name": "partner-portal",
    "displayName": "Partner Portal",
    "enabled": true
  },
  "clients": [...],
  "roles": [...],
  "groups": [...],
  "users": [
    // Only included if includeUsers=true
  ],
  "clientSecrets": {
    // Only included if includeSecrets=true
  }
}
```

## Import Realm

```
POST /admin/realms/import
```

Imports realm configuration from JSON.

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `overwrite` | false | Overwrite existing realm with same name |

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/import?overwrite=true" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d @realm-export.json
```

### Response

```json
{
  "message": "Realm imported successfully",
  "realm": "partner-portal"
}
```

## List Available Themes

```
GET /admin/realms/themes
```

Returns list of themes available for realm customization.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/themes" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "data": [
    {
      "name": "idenplane",
      "displayName": "Idenplane Default",
      "types": ["login", "account", "email"]
    },
    {
      "name": "keycloak",
      "displayName": "Keycloak Compatible",
      "types": ["login", "account", "email"]
    }
  ]
}
```

## Send Test Email

```
POST /admin/realms/:realmName/email/test
```

Sends a test email to verify SMTP configuration.

### Request Body

```json
{
  "to": "admin@example.com"
}
```

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/partner-portal/email/test" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "admin@example.com"
  }'
```

### Response

```json
{
  "message": "Test email sent successfully"
}
```

## Realm Object Schema

```json
{
  "id": "string (UUID)",
  "name": "string",
  "displayName": "string",
  "displayNameHtml": "string",
  "enabled": "boolean",
  "registrationAllowed": "boolean",
  "loginWithEmailAllowed": "boolean",
  "duplicateEmailsAllowed": "boolean",
  "passwordPolicy": "string",
  "accessTokenLifespan": "integer (seconds)",
  "refreshTokenLifespan": "integer (seconds)",
  "ssoSessionIdleTimeout": "integer (seconds)",
  "ssoSessionMaxLifespan": "integer (seconds)",
  "offlineSessionIdleTimeout": "integer (seconds)",
  "bruteForceProtected": "boolean",
  "maxLoginFailures": "integer",
  "failureResetTime": "integer (seconds)",
  "smtpConfig": {
    "host": "string",
    "port": "integer",
    "from": "string",
    "fromName": "string",
    "replyTo": "string"
  },
  "theme": {
    "login": "string",
    "account": "string",
    "email": "string"
  },
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `ValidationError` | Invalid request body or parameters |
| 401 | `Unauthorized` | Missing or invalid API key |
| 403 | `Forbidden` | Requires super-admin role |
| 404 | `NotFound` | Realm not found |
| 409 | `Conflict` | Realm name already exists |

## Password Policy Syntax

Password policies use a simple DSL format:

| Policy | Example | Description |
|--------|---------|-------------|
| `length(N)` | `length(8)` | Minimum password length |
| `specialChar(N)` | `specialChar(1)` | Required special characters |
| `upperChar(N)` | `upperChar(1)` | Required uppercase letters |
| `digit(N)` | `digit(1)` | Required digits |
| `lowerChar(N)` | `lowerChar(1)` | Required lowercase letters |
| `regex(PATTERN)` | `regex([a-z])` | Regex pattern requirement |
| `notUsername()` | `notUsername()` | Cannot contain username |
| `notEmail()` | `notEmail()` | Cannot contain email |

Combine with `and`:

```
passwordPolicy: "length(8) and specialChar(1) and digit(1) and notUsername()"
```
