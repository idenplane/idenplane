---
id: options
title: Configuration Options
sidebar_position: 2
description: Reference for the realm, client and related settings available through the Admin API and Admin Console.
---

# Configuration Options

This reference covers the settings you make per realm, through the Admin Console or the Admin API. Server-wide settings are [environment variables](./environment-variables.md). The SDKs are client libraries for signing users in; they do not change realm settings.

The admin API rejects a field it does not know with `400`, so use the names below exactly. The full list of fields for each endpoint is in the server's own OpenAPI reference at `/api`.

---

## Quick Reference by Category

| Category | Description | Key Options |
|----------|-------------|-------------|
| [Realms](#realm-configuration) | Top-level tenant settings | name, displayName, enabled |
| [Security](#security-configuration) | Sign-in and registration | registrationAllowed, mfaRequired, webAuthnEnabled |
| [Themes](#theme-configuration) | UI customization | loginTheme, accountTheme, emailTheme |
| [Email](#email-configuration) | SMTP and email providers | smtpHost, smtpPort, smtpFrom, emailProvider |
| [Sessions](#session-configuration) | Session management | refreshTokenLifespan, maxSessionsPerUser |
| [Clients](#client-configuration) | OAuth client settings | clientId, clientType, redirectUris, grantTypes |
| [Password Policy](#password-policy) | Password requirements | passwordMinLength, passwordRequireDigits |
| [MFA](#mfa-configuration) | Multi-factor authentication | mfaRequired, smsMfaEnabled |
| [Brute Force](#brute-force-protection) | Login attack protection | bruteForceEnabled, maxLoginFailures, lockoutDuration |
| [Events](#event-configuration) | Audit logging | eventsEnabled, adminEventsEnabled |

---

## Realm Configuration

Realms are top-level tenants in Idenplane, each with isolated user pools, clients, and configuration.

### Core Realm Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | — | Unique realm name, used in URLs. Set at creation; it cannot be changed |
| `displayName` | string | — | Human-readable name shown in UI |
| `enabled` | boolean | `true` | Whether the realm is active |
| `defaultLocale` | string | `en` | Default locale of the hosted pages |
| `supportedLocales` | string[] | `["en"]` | Locales the hosted pages offer |

### API Endpoints

```
GET    /admin/realms/{realm}
POST   /admin/realms
PUT    /admin/realms/{realm}      # partial update, same as PATCH
PATCH  /admin/realms/{realm}
DELETE /admin/realms/{realm}
GET    /admin/realms/{realm}/export
POST   /admin/realms/import
```

See [Realms API](../api/realms.md).

---

## Security Configuration

### Sign-in and Registration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `registrationAllowed` | boolean | **`true`** | Self-registration on the hosted pages. It is on for a new realm: turn it off if users should not sign themselves up |
| `captchaEnabled` | boolean | `false` | Require a CAPTCHA (reCAPTCHA v3 or hCaptcha) for self-registration; see [Self-Registration and CAPTCHA](/guides/registration-captcha) |
| `magicLinkEnabled` | boolean | `false` | Passwordless sign-in by e-mailed link |
| `webAuthnEnabled` | boolean | `false` | Passkeys (WebAuthn) |
| `impersonationEnabled` | boolean | `false` | Let admins impersonate users |
| `impersonationMaxDuration` | integer | `1800` | Longest impersonation session, in seconds |
| `bruteForceEnabled` | boolean | `true` for new realms | Temporary account lockout after repeated failed sign-ins. See [Brute Force Protection](#brute-force-protection). |

---

## Theme Configuration

### Theme Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `loginTheme` | string | `idenplane` | Theme for the login, registration and password-reset pages |
| `accountTheme` | string | `idenplane` | Theme for the account pages |
| `emailTheme` | string | `idenplane` | Theme for e-mails |
| `themeName` | string | — | Theme preset |
| `theme` | object | — | Color overrides |

The built-in themes are `idenplane` and `midnight`. Their templates are Handlebars (`.hbs`) files under `themes/<name>/login`, `account` and `email`.

### Custom Themes

Build a theme in the console's **Theme Builder**, or through the theme API:

```
GET    /admin/realms/{realm}/themes
POST   /admin/realms/{realm}/themes
PUT    /admin/realms/{realm}/themes/{id}
DELETE /admin/realms/{realm}/themes/{id}
```

See [Custom Themes](../guides/custom-themes.mdx).

---

## Email Configuration

### SMTP Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `smtpHost` | string | — | SMTP server hostname |
| `smtpPort` | integer | `587` | SMTP port |
| `smtpSecure` | boolean | `false` | Implicit TLS (port 465). With `false`, STARTTLS is used when the server offers it |
| `smtpUser` | string | — | SMTP username |
| `smtpPassword` | string | — | SMTP password (encrypted at rest) |
| `smtpFrom` | string | — | Sender address |
| `emailProvider` | string | `smtp` | `smtp`, `resend`, `sendgrid`, `mailgun` or `postmark` |
| `emailProviderConfig` | object | — | The chosen API provider's settings |

### Test Email Configuration

```bash
curl -X POST http://localhost:3000/admin/realms/{realm}/email/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "user@example.com"
  }'
```

`POST /admin/realms/{realm}/smtp/test` sends a test message to the realm's own sender address.

---

## Session Configuration

### Session Timeouts

These are the realm settings that bound a session. All values are seconds.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accessTokenLifespan` | integer | `300` | Access token lifetime |
| `refreshTokenLifespan` | integer | `1800` | Refresh token lifetime. Also the lifetime of the OAuth session it belongs to: refreshing does not extend the session. |
| `offlineTokenLifespan` | integer | `2592000` | Lifetime of an `offline_access` refresh token |
| `maxSessionsPerUser` | integer | `10` | Sessions per user; the oldest is ended when a new one would go over |

The hosted-login SSO cookie lasts for the browser session, or 30 days with "remember me". There is no idle timeout for SSO sessions yet; see the [ASVS assessment](../security/asvs-assessment.md#remaining-gaps).

### API Endpoints

```
GET   /admin/realms/{realm}
PATCH /admin/realms/{realm}
GET   /admin/realms/{realm}/sessions
GET   /admin/realms/{realm}/users/{userId}/sessions
```

All lifetimes are integers in seconds.

---

## Client Configuration

### Client Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientId` | string | — | Unique client identifier (required) |
| `name` | string | — | Human-readable client name |
| `description` | string | — | Client description |
| `enabled` | boolean | `true` | Client is active |
| `clientType` | string | `CONFIDENTIAL` | `CONFIDENTIAL` or `PUBLIC` (no secret; PKCE required) |
| `publicClient` | boolean | — | Shorthand for `clientType: "PUBLIC"` |
| `requireConsent` | boolean | `false` | Require explicit consent |
| `redirectUris` | string[] | — | Allowed redirect URIs |
| `postLogoutRedirectUris` | string[] | — | Allowed `post_logout_redirect_uri` values; falls back to `redirectUris` when empty |
| `webOrigins` | string[] | — | Allowed CORS origins (`*` is refused) |
| `grantTypes` | string[] | `["authorization_code"]` | Allowed grants: `authorization_code`, `refresh_token`, `client_credentials`, `password`, `urn:ietf:params:oauth:grant-type:device_code` |
| `tokenEndpointAuthMethod` | string | — | `client_secret_basic`, `client_secret_post`, `tls_client_auth`, `self_signed_tls_client_auth` or `none` |
| `backchannelLogoutUri` | string | — | OIDC back-channel logout URL |
| `requiredAcr` | string | — | Minimum ACR for this client |

The secret of a confidential client is generated by the server and shown once, in the create response and when you regenerate it. Token lifetimes are realm settings.

### API Endpoints

```
GET    /admin/realms/{realm}/clients
POST   /admin/realms/{realm}/clients
GET    /admin/realms/{realm}/clients/{id}
PUT    /admin/realms/{realm}/clients/{id}      # partial update, same as PATCH
DELETE /admin/realms/{realm}/clients/{id}
POST   /admin/realms/{realm}/clients/{id}/regenerate-secret
```

### Create a Client

```bash
curl -X POST http://localhost:3000/admin/realms/{realm}/clients \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "my-app",
    "name": "My Application",
    "description": "My application using Idenplane",
    "clientType": "CONFIDENTIAL",
    "redirectUris": ["http://localhost:3000/callback"],
    "webOrigins": ["http://localhost:3000"],
    "grantTypes": ["authorization_code", "refresh_token", "client_credentials"]
  }'
```

See [Clients API](../api/clients.md).

---

## Password Policy

The password policy is a set of realm fields. Passwords are hashed with Argon2id.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `passwordMinLength` | integer | `8` | Minimum password length |
| `passwordRequireUppercase` | boolean | `false` | At least one uppercase letter |
| `passwordRequireLowercase` | boolean | `false` | At least one lowercase letter |
| `passwordRequireDigits` | boolean | `false` | At least one digit |
| `passwordRequireSpecialChars` | boolean | `false` | At least one special character |
| `passwordHistoryCount` | integer | `0` | Previous passwords that cannot be reused |
| `passwordMaxAgeDays` | integer | `0` | Days until a password expires; `0` never |

```bash
curl -X PATCH http://localhost:3000/admin/realms/{realm} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "passwordMinLength": 12,
    "passwordRequireDigits": true,
    "passwordRequireUppercase": true,
    "passwordRequireSpecialChars": true
  }'
```

---

## MFA Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mfaRequired` | boolean | `false` | Every user must have a second factor; users without one enrol at sign-in |
| `smsMfaEnabled` | boolean | `false` | Text-message codes as a second factor (needs an SMS provider) |
| `otpLength` | integer | `6` | Length of texted codes |
| `otpExpirySeconds` | integer | `300` | Lifetime of a texted code |

Authenticator-app (TOTP) codes are fixed at SHA-1, 6 digits and a 30-second step; they are not configurable. Users get 10 one-time recovery codes with their first factor. See the [MFA guide](../guides/mfa.mdx).

### API Endpoints

```
GET    /admin/realms/{realm}/users/{userId}/mfa/status
DELETE /admin/realms/{realm}/users/{userId}/mfa          # all factors (asks for admin MFA step-up)
DELETE /admin/realms/{realm}/users/{userId}/mfa/totp
DELETE /admin/realms/{realm}/users/{userId}/mfa/sms
PUT    /admin/realms/{realm}/users/{userId}/reset-password
```

---

## Brute Force Protection

Brute-force protection locks an account for a while after repeated failed sign-ins. It is **on for realms created since 0.10.0**; realms created earlier keep their setting. The trade-offs behind the defaults are explained in [Secure defaults](../security/secure-defaults.md#brute-force-protection).

### Protection Settings

| Option | Type | Default (new realms) | Description |
|--------|------|---------|-------------|
| `bruteForceEnabled` | boolean | `true` | Turn the lockout on or off |
| `maxLoginFailures` | integer | `10` | Failures within `failureResetTime` that lock the account |
| `failureResetTime` | integer | `900` | Window, in seconds, in which failures are counted |
| `lockoutDuration` | integer | `300` | How long, in seconds, the account stays locked |
| `permanentLockoutAfter` | integer | `0` | Lockouts after which the account is disabled for good. `0` = never. Anyone who knows a username can trigger it, so leave it at `0` unless you accept that. |

### Lockout Behavior

1. When `maxLoginFailures` failures fall within `failureResetTime`, the account is locked for `lockoutDuration`.
2. While it is locked, sign-in is refused before the password is checked, with the same answer for a right and a wrong password.
3. The lock ends by itself. Failures stay counted for the rest of the window, so a wrong password right after the lock locks it again (progressive lockout).
4. A successful sign-in clears the failures.

### API Endpoints

```
PATCH /admin/realms/{realm}                                   # change the settings
GET   /admin/realms/{realm}/brute-force/locked-users          # list locked users
POST  /admin/realms/{realm}/brute-force/users/{userId}/unlock # unlock (asks for MFA step-up)
```

---

## Event Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `eventsEnabled` | boolean | `true` for new realms | Record sign-in events (realms created before 0.10.0 keep their setting) |
| `adminEventsEnabled` | boolean | `true` | Record admin changes |
| `loginEventRetentionDays` | integer | `30` | Days sign-in events are kept |
| `adminEventRetentionDays` | integer | `90` | Days admin events are kept |

Recorded sign-in events include `LOGIN`, `LOGIN_ERROR`, `LOGOUT`, `REGISTER`, `REFRESH_TOKEN`, `CODE_TO_TOKEN`, `CLIENT_LOGIN` and the MFA events. Each can also go to a [webhook](../guides/webhooks.mdx).

### API Endpoints

```
GET /admin/realms/{realm}/events
GET /admin/realms/{realm}/events/login/export
GET /admin/realms/{realm}/admin-events
GET /admin/realms/{realm}/events/admin/export
```

---

## Client Scopes

### Standard Scopes

| Scope | Claims |
|-------|--------|
| `openid` | `sub` |
| `profile` | `name`, `family_name`, `given_name`, `preferred_username`, `updated_at` |
| `email` | `email`, `email_verified` |
| `roles` | `realm_access`, `resource_access` |
| `offline_access` | none; requests an offline refresh token |

### Client Scope Management

```bash
# Get all client scopes
curl http://localhost:3000/admin/realms/{realm}/client-scopes \
  -H "Authorization: Bearer $TOKEN"
```

### Scope-to-Client Assignment

```
GET    /admin/realms/{realm}/clients/{clientId}/default-client-scopes
POST   /admin/realms/{realm}/clients/{clientId}/default-client-scopes             # scope in the body
DELETE /admin/realms/{realm}/clients/{clientId}/default-client-scopes/{scopeId}
```

---

## Role Configuration

Idenplane creates no default roles in a realm. A role has a `name` and a `description`; there are no composite roles.

```bash
# Create realm role
curl -X POST http://localhost:3000/admin/realms/{realm}/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "admin",
    "description": "Administrator role"
  }'

# Assign it to a user
curl -X POST http://localhost:3000/admin/realms/{realm}/users/{userId}/role-mappings/realm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleNames": ["admin"]}'
```

---

## User Federation

### LDAP Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | — | Provider name |
| `providerType` | string | `ldap` | Provider type |
| `enabled` | boolean | `true` | Provider is active |
| `priority` | integer | `0` | Provider priority |
| `connectionUrl` | string | — | `ldap://` or `ldaps://` URL |
| `startTls` | boolean | `false` | Upgrade an `ldap://` connection with STARTTLS |
| `connectionTimeout` | integer | `5000` | Milliseconds |
| `bindDn` | string | — | Service account DN |
| `bindCredential` | string | — | Service account password (encrypted at rest) |
| `usersDn` | string | — | Base DN for user searches |
| `userObjectClass` | string | `inetOrgPerson` | Object class of user entries |
| `usernameLdapAttr` | string | `uid` | LDAP attribute for username |
| `rdnLdapAttr` | string | `uid` | RDN LDAP attribute |
| `uuidLdapAttr` | string | `entryUUID` | Unique ID attribute (`objectGUID` for Active Directory) |
| `searchFilter` | string | — | Extra LDAP filter |
| `syncMode` | string | `on_demand` | When users are synchronised |
| `syncPeriod` | integer | `3600` | Seconds between scheduled syncs |
| `importEnabled` | boolean | `true` | Import users into Idenplane |
| `editMode` | string | `READ_ONLY` | Whether changes are written back |

Kerberos is not supported.

---

## Webhook Configuration

### Webhook Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | — | Webhook endpoint URL |
| `eventTypes` | string[] | — | Events to send (required; `events` is accepted as an alias) |
| `secret` | string | — | HMAC signing secret, at least 8 characters |
| `description` | string | — | Description |
| `enabled` | boolean | `true` | Enable/disable webhook |

Event names are lowercase and prefixed, for example `user.login`, `user.login_error`, `user.registered`; the full list is in the [Webhooks guide](../guides/webhooks.mdx). Retries follow a fixed schedule.

### Registering Webhooks

```bash
curl -X POST http://localhost:3000/admin/realms/{realm}/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhooks/idenplane",
    "eventTypes": ["user.login", "user.logout", "user.registered"],
    "secret": "example-webhook-secret",
    "enabled": true
  }'
```

### Verifying Webhooks

Idenplane signs each payload with HMAC-SHA256 and sends `X-Webhook-Signature: sha256=<hex>` with `X-Webhook-Timestamp`. The [Webhooks guide](../guides/webhooks.mdx) shows exactly what is signed and how to verify it.

---

## Default Values Reference

The defaults of a new realm:

```typescript
const defaultRealmConfig = {
  // Security
  registrationAllowed: true,
  bruteForceEnabled: true, // new realms since 0.10.0
  mfaRequired: false,

  // Sessions & Tokens (seconds)
  accessTokenLifespan: 300,
  refreshTokenLifespan: 1800,
  offlineTokenLifespan: 2592000,
  maxSessionsPerUser: 10,

  // Password policy
  passwordMinLength: 8,

  // Brute Force (new realms since 0.10.0)
  maxLoginFailures: 10,
  failureResetTime: 900,
  lockoutDuration: 300,
  permanentLockoutAfter: 0,

  // Events
  eventsEnabled: true, // new realms since 0.10.0
  adminEventsEnabled: true,
  loginEventRetentionDays: 30,
  adminEventRetentionDays: 90,

  // Themes
  loginTheme: 'idenplane',
  accountTheme: 'idenplane',
  emailTheme: 'idenplane',
};
```

---

## Next Steps

<div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem'}}>

[**Environment Variables**](/configuration/environment-variables)
Environment-based configuration reference

[**Admin API**](/api/realms)
Manage realms programmatically

[**Deployment**](/deployment/docker)
Deploy with Docker Compose

</div>

---

<p align="center">
  <a href="https://idenplane.com">idenplane.com</a> &middot;
  <a href="https://github.com/idenplane/idenplane">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>