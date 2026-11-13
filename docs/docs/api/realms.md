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
-H "x-admin-api-key: your-api-key-here"
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
  -H "x-admin-api-key: your-api-key-here"
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
| `captchaEnabled` | boolean | No | Require a CAPTCHA for self-registration. When `true`, `captchaProvider` and that provider's site key and secret key are required (`400` otherwise); the secret may instead come from `RECAPTCHA_SECRET_KEY` / `HCAPTCHA_SECRET_KEY`. See [Self-Registration and CAPTCHA](/guides/registration-captcha) |
| `captchaProvider` | string | No | `recaptcha` (reCAPTCHA v3) or `hcaptcha` |
| `recaptchaSiteKey`, `recaptchaSecretKey` | string | No | reCAPTCHA v3 keys (the secret is encrypted at rest) |
| `hcaptchaSiteKey`, `hcaptchaSecretKey` | string | No | hCaptcha keys (the secret is encrypted at rest) |
| `captchaScoreThreshold` | number | No | Lowest reCAPTCHA v3 score accepted, 0 to 1 (default `0.5`) |
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
  -H "x-admin-api-key: your-api-key-here" \
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
  -H "x-admin-api-key: your-api-key-here"
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
  -H "x-admin-api-key: your-api-key-here" \
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
  -H "x-admin-api-key: your-api-key-here" \
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
  -H "x-admin-api-key: your-api-key-here"
```

### Response

Returns HTTP 204 No Content on success.

## Export Realm

```
GET /admin/realms/:realmName/export
```

Exports the realm's configuration as JSON (format `version: 2`). Import the file on the same or another Idenplane server with [Import Realm](#import-realm).

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `includeUsers` | false | Include users, their role and group mappings, custom attribute values and organization memberships. Never their passwords or MFA factors. |
| `includeSecrets` | false | Include secrets (see [Secrets](#secrets)). |

### Request Example

```bash
# Configuration only, no secrets
curl "http://localhost:3000/admin/realms/partner-portal/export" \
  -H "x-admin-api-key: your-api-key-here"

# With users, still without secrets
curl "http://localhost:3000/admin/realms/partner-portal/export?includeUsers=true" \
  -H "x-admin-api-key: your-api-key-here"

# Everything, for a full migration
curl "http://localhost:3000/admin/realms/partner-portal/export?includeUsers=true&includeSecrets=true" \
  -H "x-admin-api-key: your-api-key-here"
```

### What is included

The export contains every realm setting and every client setting. An allow-list in the code covers every database column. A test fails when a new column is neither exported nor excluded with a reason, so a new setting cannot be left out by mistake.

| Section | Contents |
|---------|----------|
| `realm` | All realm settings: token lifespans, email (SMTP and provider), password policy, brute force, registration, CAPTCHA, email verification, MFA, WebAuthn, SMS MFA and OTP, magic links, impersonation, events and their retention, rate limits, themes and locales, sessions, adaptive authentication, SCIM, account deletion, mTLS, auth flows. `browserFlow` names the bound flow. |
| `authenticationFlows` | Flows with their steps. |
| `clientScopes` | Scopes with their protocol mappers. |
| `clients` | All client settings: post-logout redirect URIs, step-up (`requiredAcr`), token endpoint authentication, the `tlsClientAuth*` rules and certificate-bound tokens. Also the bound flow (`authFlow`), the default and optional scopes, the service account with its roles and groups (`serviceAccount`) and the registered certificates (`tlsCertificates`). |
| `roles`, `groups` | Realm and client roles, and groups with their parent and role mappings. |
| `identityProviders`, `samlServiceProviders`, `userFederations` | Brokering, SAML service providers, and LDAP federation with its mappers. |
| `tlsTrustAnchors`, `tlsRevokedCertificates` | The realm's certificate authorities and its deny-list. |
| `customAttributes`, `registrationFields`, `organizations`, `consentCategories`, `themes` | Profile attributes, the registration form, organizations with their SSO connections, consent categories with their policies, and theme builder themes. |
| `webhooks`, `auditLogStreams`, `policies`, `continuousRiskPolicies`, `scimAttributeMappings`, `serviceAccounts`, `nhiCredentialPolicies`, `proxyApplications` | The rest of the realm configuration. |
| `users` | Only with `includeUsers=true`. |
| `omitted` | What the export left out, and why. The import ignores it. |

References between objects use names, never database ids:

- a flow by name;
- a client by `clientId`;
- a scope by name;
- a role by name and `clientId`;
- a group by name;
- a user by username.

**Never exported:**

- The realm's signing keys. The imported realm gets a new key pair, so tokens issued by the old realm are not valid there.
- Password hashes and other user credentials: TOTP, passkeys, recovery codes and enrolled phone numbers.
- Sessions, tokens and one-time codes.
- API keys and SCIM tokens.
- Brute-force and risk counters.
- All event and audit logs.
- NHI identities and their credentials. Their OAuth clients are listed under `omitted`.
- The theme builder's version history. Each theme's current content is exported.

### Secrets

Without `includeSecrets`, the file contains no secrets. With it, the file contains:

- each client's secret **hash**. The secret itself cannot be recovered; the hash keeps the same secret working after import;
- the SMTP password, the CAPTCHA secret keys, and the email and SMS provider credentials, **decrypted**;
- identity provider client secrets, LDAP bind credentials, webhook signing secrets (decrypted), audit stream HTTP headers and organization SSO connection configuration.

Values encrypted at rest are exported decrypted. The importing server encrypts them again with its own `WEBHOOK_SECRET_KEY`, so the two servers do not need the same key.

:::warning
A file made with `includeSecrets` holds live credentials. Store and transfer it as you would a password vault.
:::

A file without secrets still imports, and the response lists `warnings`. Objects that cannot work without their secret are imported **disabled**:

- identity providers;
- LDAP federations;
- organization SSO connections;
- webhooks, which also get a new random secret.

Confidential clients that authenticate with a secret have none until you regenerate it.

### Response

```json
{
  "version": 2,
  "secretsIncluded": false,
  "usersIncluded": false,
  "realm": { "name": "partner-portal", "displayName": "Partner Portal", "browserFlow": "browser-mfa", "...": "..." },
  "authenticationFlows": [{ "name": "browser-mfa", "steps": ["..."] }],
  "clients": [{ "clientId": "portal", "authFlow": null, "defaultScopes": ["openid"], "serviceAccount": null, "tlsCertificates": [], "...": "..." }],
  "roles": [{ "name": "admin", "description": null, "clientId": null }],
  "groups": [{ "name": "staff", "parentName": null, "roles": [{ "name": "admin", "clientId": null }] }],
  "...": "...",
  "omitted": []
}
```

The full shape is in the OpenAPI document (`/api`).

## Import Realm

```
POST /admin/realms/import
```

Creates a realm from an export file. Requires the `super-admin` role.

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `overwrite` | false | Replace an existing realm with the same name |

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/import?overwrite=true" \
  -H "x-admin-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d @realm-export.json
```

To import under another name, change `realm.name` in the file.

### Validation and safety

- **The whole file is checked before anything is written.** The checks cover types, allowed values, unknown fields, references that do not resolve, duplicate names, client authentication rules and certificates. Every authentication flow goes through the same validator as the flow API. Any problem returns `400` with every problem and its path:

  ```json
  {
    "statusCode": 400,
    "message": "Invalid realm import: clients[0].authFlow: no flow named 'browser-mfa' in authenticationFlows",
    "errors": [
      { "path": "clients[0].authFlow", "message": "no flow named 'browser-mfa' in authenticationFlows" }
    ]
  }
  ```

- **One transaction.** If anything fails, nothing is created.
- **`overwrite` is safe.** The old realm is deleted inside the same transaction, so a failed import leaves it exactly as it was. A successful import replaces all of the old realm's data, including users, sessions and signing keys. Tokens the old realm issued stop being valid.
- **Defaults.** A field missing from the file takes the server's default, as for a new realm.
- **Wildcard origins.** The web origin `"*"` is removed from clients, with a warning.

### Response

```json
{
  "realmName": "partner-portal",
  "version": 2,
  "clientsImported": 3,
  "rolesImported": 5,
  "groupsImported": 2,
  "scopesImported": 7,
  "idpsImported": 1,
  "usersImported": 0,
  "flowsImported": 1,
  "warnings": []
}
```

Importing a realm whose name already exists returns `409` unless `overwrite=true` is set.

### Version compatibility

| File | Import |
|------|--------|
| `version: 2` | Strict: validated as above. |
| `version: 1` (files from Idenplane before format 2, including `"1.0"`) | Imported with the same field mapping as before, in one transaction. References that do not resolve are skipped, as before. |
| Any other version | `400`. |

Version 1 files never contained the settings that format 2 added, so those settings take their defaults. After importing a version 1 file, check the realm's sign-in protection, rate limits, CAPTCHA, registration, themes and other settings. Export again from the current server to get a complete version 2 file.

### Before you upgrade

- **Scripts that read export files.** The file is now `version: 2`. Scope assignments moved from the top-level `clientScopeAssignments` into each client's `defaultScopes` and `optionalScopes`, and the file has many new sections. Update any script that reads or edits export files.
- **Unknown versions are refused.** An import accepts `version` 1 (`1`, `"1"`, `"1.0"`) or 2 (`2`, `"2"`, `"2.0"`) and answers `400` to anything else. A version 1 section that is not an array of objects is also `400` now.
- **Version 2 imports are strict.** A realm that the server holds today can fail to import again in two cases:
  - **Flows that fail today's flow validator.** Flows created before the stricter validation were not migrated. Run `POST /admin/realms/{realm}/auth-flows/{id}/validate` on each flow and fix it before exporting.
  - **Realm names that are not lowercase slugs**, which a version 1 import could create. Change `realm.name` in the file.
- **Realms already moved with an export file** kept the defaults for every setting version 1 did not carry. Check them, or export and import them again.

## List Available Themes

```
GET /admin/realms/themes
```

Returns list of themes available for realm customization.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/themes" \
  -H "x-admin-api-key: your-api-key-here"
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
  -H "x-admin-api-key: your-api-key-here" \
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
