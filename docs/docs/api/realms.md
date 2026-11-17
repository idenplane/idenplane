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

Admins with the `super-admin` role (and the admin API key) can manage all realms. A realm admin can list and read the realms assigned to them; creating, updating, deleting and importing realms needs `super-admin`.

## List Realms

```
GET /admin/realms
```

Returns the realms the caller may read, as a JSON array.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms" \
  -H "x-admin-api-key: your-api-key-here"
```

### Response

```json
[
  {
    "id": "realm-uuid-123",
    "name": "master",
    "displayName": "Master Realm",
    "enabled": true,
    "registrationAllowed": true,
    "accessTokenLifespan": 300,
    "refreshTokenLifespan": 1800,
    "offlineTokenLifespan": 2592000,
    "...": "...",
    "createdAt": "2023-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

Each entry carries all realm settings except secrets; the example is shortened.

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
| `enabled` | boolean | No | Enable realm (default: true) |
| `registrationAllowed` | boolean | No | Allow user self-registration (default: **true**) |
| `captchaEnabled` | boolean | No | Require a CAPTCHA for self-registration. When `true`, `captchaProvider` and that provider's site key and secret key are required (`400` otherwise); the secret may instead come from `RECAPTCHA_SECRET_KEY` / `HCAPTCHA_SECRET_KEY`. See [Self-Registration and CAPTCHA](/guides/registration-captcha) |
| `captchaProvider` | string | No | `recaptcha` (reCAPTCHA v3) or `hcaptcha` |
| `recaptchaSiteKey`, `recaptchaSecretKey` | string | No | reCAPTCHA v3 keys (the secret is encrypted at rest) |
| `hcaptchaSiteKey`, `hcaptchaSecretKey` | string | No | hCaptcha keys (the secret is encrypted at rest) |
| `captchaScoreThreshold` | number | No | Lowest reCAPTCHA v3 score accepted, 0 to 1 (default `0.5`) |
| `passwordMinLength` | integer | No | Minimum password length (default `8`) |
| `passwordRequireUppercase`, `passwordRequireLowercase`, `passwordRequireDigits`, `passwordRequireSpecialChars` | boolean | No | Character class requirements (default `false`) |
| `passwordHistoryCount` | integer | No | Previous passwords that cannot be reused (default `0`) |
| `passwordMaxAgeDays` | integer | No | Password expiry in days (default `0`, never) |
| `accessTokenLifespan` | integer | No | Access token lifetime in seconds (default `300`) |
| `refreshTokenLifespan` | integer | No | Refresh token lifetime in seconds (default `1800`) |
| `offlineTokenLifespan` | integer | No | Lifetime of an offline session and its `offline_access` refresh tokens, counted from sign-in (default `2592000`, 30 days). There is no separate offline idle timeout. |
| `maxSessionsPerUser` | integer | No | Concurrent sessions per user (default `10`, `0` = no limit). The oldest is ended when a new one would go over. Offline sessions don't count and are never ended by it. |
| `ssoSessionIdleTimeout` | integer | No | Idle timeout in seconds (default `0`, off). A browser SSO session not used for this long ends, and a normal refresh token not used for this long expires; offline tokens are not affected. `0` or at least `60`; make it longer than `accessTokenLifespan`. See [Idle timeout](../configuration/options.md#idle-timeout). |
| `bruteForceEnabled` | boolean | No | Temporary lockout after repeated failed sign-ins. Defaults to `true` for a new realm. |
| `maxLoginFailures` | integer | No | Failures within `failureResetTime` that lock the account (default `10`) |
| `lockoutDuration` | integer | No | Lockout length in seconds (default `300`) |
| `failureResetTime` | integer | No | Window in seconds in which failures are counted (default `900`) |
| `permanentLockoutAfter` | integer | No | Lockouts after which the account is disabled; `0` (default) never disables it |
| `smtpHost`, `smtpPort`, `smtpUser`, `smtpPassword`, `smtpFrom`, `smtpSecure` | | No | SMTP settings (`smtpPort` default `587`) |
| `emailProvider`, `emailProviderConfig` | | No | `smtp`, `resend`, `sendgrid`, `mailgun` or `postmark`, and its settings |
| `themeName`, `loginTheme`, `accountTheme`, `emailTheme`, `theme` | | No | Theme selection and color overrides |

The DTO has more settings (MFA, WebAuthn, SMS, magic links, events, locales, sessions, CAPTCHA above); the server's `/api` lists them all. A field the DTO does not know is rejected with `400`.

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms" \
  -H "x-admin-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "partner-portal",
    "displayName": "Partner Portal",
    "registrationAllowed": false,
    "passwordMinLength": 10,
    "passwordRequireSpecialChars": true,
    "accessTokenLifespan": 600,
    "bruteForceEnabled": true,
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
  "accessTokenLifespan": 600,
  "refreshTokenLifespan": 1800,
  "offlineTokenLifespan": 2592000,
  "passwordMinLength": 10,
  "passwordRequireSpecialChars": true,
  "bruteForceEnabled": true,
  "maxLoginFailures": 5,
  "lockoutDuration": 300,
  "failureResetTime": 900,
  "permanentLockoutAfter": 0,
  "...": "...",
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
  "enabled": true,
  "registrationAllowed": false,
  "accessTokenLifespan": 600,
  "refreshTokenLifespan": 1800,
  "offlineTokenLifespan": 2592000,
  "passwordMinLength": 10,
  "passwordRequireSpecialChars": true,
  "bruteForceEnabled": true,
  "maxLoginFailures": 5,
  "lockoutDuration": 300,
  "failureResetTime": 900,
  "permanentLockoutAfter": 0,
  "...": "...",
  "createdAt": "2024-02-01T10:00:00Z",
  "updatedAt": "2024-02-01T10:00:00Z"
}
```

## Update Realm

```
PUT /admin/realms/:realmName
```

Updates an existing realm. Requires `super-admin` role. Only the fields you send change: `PUT` and `PATCH` behave the same. The name cannot be changed; sending `name` is rejected with `400`.

### Request Example

```bash
curl -X PUT "http://localhost:3000/admin/realms/partner-portal" \
  -H "x-admin-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Partner Portal Updated",
    "registrationAllowed": false,
    "passwordMinLength": 12
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
    "passwordMinLength": 8
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
- identity provider client secrets, LDAP bind credentials and webhook signing secrets, **decrypted**;
- audit stream HTTP headers and organization SSO connection configuration, with their encrypted values **decrypted**. Without `includeSecrets` these two are left out whole.

Realm signing keys and TOTP seeds are never exported; the imported realm gets a new key pair.

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

The request body may be up to **10 MB**, the limit of the import endpoints (every other endpoint keeps 100 KB). A larger file is refused with `413 Payload Too Large`.

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
- **Authorization policies** are checked like the policies API checks them: an unknown operator, a value the operator cannot use (an invalid CIDR or regular expression, `in` without an array), or an unknown `effect` or `logic` is a `400` with its path, for example `policies[0].subjectConditions[1]`.

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
[
  {
    "name": "idenplane",
    "displayName": "Idenplane (Default)",
    "description": "...",
    "colors": { "...": "..." },
    "warnings": []
  },
  {
    "name": "midnight",
    "displayName": "Midnight",
    "description": "...",
    "colors": { "...": "..." },
    "warnings": []
  }
]
```

The built-in themes are `idenplane` and `midnight`.

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
  "success": true,
  "message": "Test email sent successfully"
}
```

A missing `to` or a realm without e-mail settings also returns HTTP 200, with `{"success": false, "error": "..."}`. `POST /admin/realms/:realmName/smtp/test` sends a test message to the realm's own sender address.

## Realm Object Schema

```json
{
  "id": "string (UUID)",
  "name": "string",
  "displayName": "string",
  "enabled": "boolean",
  "registrationAllowed": "boolean",
  "passwordMinLength": "integer",
  "passwordRequireUppercase": "boolean",
  "passwordRequireLowercase": "boolean",
  "passwordRequireDigits": "boolean",
  "passwordRequireSpecialChars": "boolean",
  "passwordHistoryCount": "integer",
  "passwordMaxAgeDays": "integer",
  "accessTokenLifespan": "integer (seconds)",
  "refreshTokenLifespan": "integer (seconds)",
  "offlineTokenLifespan": "integer (seconds)",
  "maxSessionsPerUser": "integer",
  "ssoSessionIdleTimeout": "integer (seconds, 0 = off)",
  "bruteForceEnabled": "boolean",
  "maxLoginFailures": "integer",
  "lockoutDuration": "integer (seconds)",
  "failureResetTime": "integer (seconds)",
  "permanentLockoutAfter": "integer",
  "smtpHost": "string",
  "smtpPort": "integer",
  "smtpFrom": "string",
  "smtpSecure": "boolean",
  "loginTheme": "string",
  "accountTheme": "string",
  "emailTheme": "string",
  "...": "more settings; see /api",
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

## Password Policy

The password policy is a set of realm fields, not a policy string:

| Field | Default | Description |
|-------|---------|-------------|
| `passwordMinLength` | `8` | Minimum password length |
| `passwordRequireUppercase` | `false` | At least one uppercase letter |
| `passwordRequireLowercase` | `false` | At least one lowercase letter |
| `passwordRequireDigits` | `false` | At least one digit |
| `passwordRequireSpecialChars` | `false` | At least one special character |
| `passwordHistoryCount` | `0` | Previous passwords that cannot be reused |
| `passwordMaxAgeDays` | `0` | Days until a password expires; `0` never |

Passwords are hashed with Argon2id.
