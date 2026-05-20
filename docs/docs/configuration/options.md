---
id: options
title: Configuration Options
sidebar_position: 2
description: Complete reference for all Idenplane configuration options available through the Admin API and Admin Console.
---

# Configuration Options

This reference documents all configuration options available in Idenplane, organized by category. Options can be set through the Admin API, Admin Console, or programmatically via the SDK.

---

## Quick Reference by Category

| Category | Description | Key Options |
|----------|-------------|-------------|
| [Realms](#realm-configuration) | Top-level tenant settings | name, displayName, enabled, sslPolicy |
| [Security](#security-configuration) | Authentication & authorization | registrationAllowed, loginWithEmail, passwordPolicy |
| [Themes](#theme-configuration) | UI customization | loginTheme, accountTheme, adminTheme |
| [Email](#email-configuration) | SMTP and email templates | from, fromDisplayName, smtpHost, smtpPort |
| [Sessions](#session-configuration) | Session management | ssoSessionIdleTimeout, ssoSessionMaxLifespan |
| [Tokens](#token-configuration) | OAuth token settings | accessTokenLifespan, refreshTokenMaxReuse |
| [Clients](#client-configuration) | OAuth client settings | clientId, clientSecret, redirectUris |
| [Password Policy](#password-policy) | Password requirements | minLength, requireUppercase, notUsername |
| [MFA](#mfa-configuration) | Multi-factor authentication | totpPeriod, totpDigits, otpPolicy |
| [Brute Force](#brute-force-protection) | Login attack protection | failureFactor, waitIncrementSeconds |
| [Events](#event-configuration) | Audit logging | eventsEnabled, eventsListeners |

---

## Realm Configuration

Realms are top-level tenants in Idenplane, each with isolated user pools, clients, and configuration.

### Core Realm Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | string | — | Unique realm identifier (immutable) |
| `realm` | string | — | Alias for `id`, used in API paths |
| `enabled` | boolean | `true` | Whether the realm is active |
| `displayName` | string | — | Human-readable name shown in UI |
| `displayNameHtml` | string | — | HTML-formatted display name |
| `sslPolicy` | string | `"external-request"` | SSL requirement: `none`, `external-request`, `all` |
| `registrationAllowed` | boolean | `false` | Allow self-registration |
| `loginWithEmailAllowed` | boolean | `true` | Allow login with email address |
| `duplicateEmailsAllowed` | boolean | `false` | Allow multiple users with same email |
| `resetPasswordAllowed` | boolean | `true` | Allow password reset flow |

### Realm Attributes

Custom attributes can be added to realms:

```json
{
  "attributes": {
    "customOption": "value",
    "maxUsers": "1000"
  }
}
```

### API Endpoints

```
GET    /admin/realms/{realm}
POST   /admin/realms
PUT    /admin/realms/{realm}
DELETE /admin/realms/{realm}
GET    /admin/realms/{realm}/export
POST   /admin/realms/{realm}/import
```

---

## Security Configuration

### Authentication Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `registrationAllowed` | boolean | `false` | Enable self-registration |
| `registrationEmailAsUsername` | boolean | `false` | Use email as username |
| `loginWithEmailAllowed` | boolean | `true` | Allow email-based login |
| `duplicateEmailsAllowed` | boolean | `false` | Multiple users per email |
| `resetPasswordAllowed` | boolean | `true` | Password reset enabled |
| `editUsernameAllowed` | boolean | `false` | Users can change username |
| `bruteForceProtected` | boolean | `true` | Enable brute force protection |

### OAuth 2.0 Flows

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `oauth2DeviceCodeLifespan` | integer | `600` | Device code lifespan (seconds) |
| `oauth2DevicePollingInterval` | integer | `5` | Polling interval (seconds) |
| `internationalizationEnabled` | boolean | `false` | Enable i18n |
| `supportedLocales` | string[] | — | Supported locale codes |

### API Endpoints

```
PUT /admin/realms/{realm}
```

---

## Theme Configuration

Idenplane supports customizable themes for different UI contexts.

### Theme Types

| Theme | Description | Options |
|-------|-------------|---------|
| `loginTheme` | Login, registration, password reset screens | `idenplane`, `base`, custom themes |
| `accountTheme` | User account management console | `idenplane`, `base`, custom themes |
| `adminTheme` | Admin console (legacy) | `idenplane`, `base`, custom themes |
| `emailTheme` | Email templates | `idenplane`, `base`, custom themes |

### Theme Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `loginTheme` | string | `idenplane` | Theme for login pages |
| `accountTheme` | string | `idenplane` | Theme for user account console |
| `adminTheme` | string | `idenplane` | Theme for admin console |
| `emailTheme` | string | `idenplane` | Theme for email templates |
| `defaultLocale` | string | `en` | Default locale (e.g., `en`, `de`, `fr`) |

### Creating Custom Themes

Custom themes are stored in the `themes/` directory:

```
themes/
  my-custom-theme/
    login/
      login.ftl
      register.ftl
      info.ftl
    account/
      account.ftl
    email/
      email-test.ftl
      email-update-password.ftl
    resources/
      css/styles.css
      img/logo.svg
```

Register custom themes via API:

```bash
curl -X POST http://localhost:3000/admin/realms/{realm}/authentication/authenticator-config \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "alias": "custom-theme",
    "config": {
      "theme": "my-custom-theme"
    }
  }'
```

---

## Email Configuration

### SMTP Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `from` | string | — | Sender email address (required) |
| `fromDisplayName` | string | — | Sender display name |
| `fromDisplayNameHtml` | string | — | HTML-formatted sender name |
| `smtpHost` | string | — | SMTP server hostname |
| `smtpPort` | integer | `587` | SMTP port (587 for TLS, 465 for SSL) |
| `smtpStartTls` | boolean | `true` | Use STARTTLS |
| `smtpSsl` | boolean | `false` | Use implicit SSL |
| `smtpUser` | string | — | SMTP username |
| `smtpPassword` | string | — | SMTP password |
| `replyTo` | string | — | Reply-to address |
| `replyToDisplayName` | string | — | Reply-to display name |
| `connectionUrl` | string | — | Full SMTP connection URL |

### Connection URL Format

```bash
# Standard connection
smtp://user:password@smtp.example.com:587

# With TLS
smtp://user:password@smtp.example.com:587/?tls=true

# With implicit SSL (port 465)
smtps://user:password@smtp.example.com:465
```

### API Endpoints

```
GET    /admin/realms/{realm}/email-provider
POST   /admin/realms/{realm}/email-provider
PUT    /admin/realms/{realm}/email-provider
DELETE /admin/realms/{realm}/email-provider
POST   /admin/realms/{realm}/email-provider/test
```

### Test Email Configuration

```bash
# Send a test email
curl -X POST http://localhost:3000/admin/realms/{realm}/email-provider/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "user@example.com"
  }'
```

---

## Session Configuration

### Session Timeouts

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ssoSessionIdleTimeout` | string | `"30m"` | Idle timeout before re-authentication |
| `ssoSessionIdleTimeoutRememberMe` | string | `"30m"` | Idle timeout with remember-me |
| `ssoSessionMaxLifespan` | string | `"8h"` | Maximum session lifetime |
| `ssoSessionMaxLifespanRememberMe` | string | `"8h"` | Max lifetime with remember-me |
| `offlineSessionIdleTimeout` | string | `"30d"` | Offline session idle timeout |
| `accessTokenLifespan` | string | `"5m"` | Access token lifetime |
| `accessTokenLifespanImplicit` | string | `"15m"` | Implicit flow token lifetime |
| `clientSessionIdleTimeout` | string | `"30m"` | Client-specific session idle timeout |
| `clientSessionMaxLifespan` | string | `"8h"` | Client-specific session max lifespan |

### Timeout Format

Timeouts use ISO 8601 duration format:
- `30m` — 30 minutes
- `8h` — 8 hours
- `7d` — 7 days

### API Endpoints

```
GET /admin/realms/{realm}
PUT /admin/realms/{realm}
```

---

## Token Configuration

### Token Lifespans

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accessTokenLifespan` | string | `"5m"` | Access token expiration |
| `accessTokenLifespanImplicit` | string | `"15m"` | Implicit flow token expiration |
| `accessCodeLifespan` | string | `"60s"` | Authorization code expiration |
| `accessCodeLifespanUserAction` | string | `"5m"` | User action code expiration |
| `accessCodeLifespanLogin` | string | `"300s"` | Login flow code expiration |
| `refreshTokenLifespan` | string | `"1h"` | Refresh token expiration |
| `refreshTokenLifespanRefreshToken` | string | `"1d"` | Offline refresh token lifespan |
| `accessTokenLifespanForActiveUsers` | string | `"5m"` | Active user token lifespan |

### Revocation Policies

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `revokeRefreshToken` | boolean | `false` | Revoke refresh tokens on use |
| `refreshTokenMaxReuse` | integer | `0` | Max refresh token reuse count |
| `notBefore` | integer | `0` | Revocation check timestamp |

### API Endpoints

```
POST /admin/realms/{realm}/oauth-access-tokens
DELETE /admin/realms/{realm}/oauth-access-tokens
POST /admin/realms/{realm}/logout-all
```

---

## Client Configuration

### Client Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientId` | string | — | Unique client identifier (required) |
| `name` | string | — | Human-readable client name |
| `description` | string | — | Client description |
| `enabled` | boolean | `true` | Client is active |
| `alwaysDisplayInConsole` | boolean | `false` | Always show in account console |
| `clientAuthenticatorType` | string | `client-secret` | Auth method: `client-secret`, `client-jwt` |
| `secret` | string | — | Client secret (for confidential clients) |
| `publicClient` | boolean | `false` | Public client (no secret) |
| `consentRequired` | boolean | `false` | Require explicit consent |

### Client URLs

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `redirectUris` | string[] | — | Allowed redirect URIs |
| `webOrigins` | string[] | — | Allowed CORS origins |
| `baseUrl` | string | — | Default redirect after login |
| `rootUrl` | string | — | Client root URL |

### Client Protocol

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `protocol` | string | `openid-connect` | Protocol: `openid-connect`, `saml` |
| `protocolMappers` | object[] | — | Protocol-specific mappers |
| `fullScopeAllowed` | boolean | `true` | Allow all realm scopes |

### Standard Flow Settings (Authorization Code)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `standardFlowEnabled` | boolean | `true` | Enable authorization code flow |
| `directAccessGrantsEnabled` | boolean | `false` | Enable resource owner password grant |
| `implicitFlowEnabled` | boolean | `false` | Enable implicit flow |
| `serviceAccountsEnabled` | boolean | `false` | Enable service account authentication |

### API Endpoints

```
GET    /admin/realms/{realm}/clients
POST   /admin/realms/{realm}/clients
GET    /admin/realms/{realm}/clients/{id}
PUT    /admin/realms/{realm}/clients/{id}
DELETE /admin/realms/{realm}/clients/{id}
POST   /admin/realms/{realm}/clients/{id}/client-secret
GET    /admin/realms/{realm}/clients/{id}/installation-files
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
    "enabled": true,
    "publicClient": false,
    "redirectUris": ["http://localhost:3000/callback"],
    "webOrigins": ["http://localhost:3000"],
    "standardFlowEnabled": true,
    "serviceAccountsEnabled": true,
    "directAccessGrantsEnabled": true
  }'
```

---

## Password Policy

Password policies enforce requirements for user passwords.

### Available Policies

| Policy | Type | Format | Default | Description |
|--------|------|--------|---------|-------------|
| `length` | integer | `length #` | `8` | Minimum password length |
| `digits` | integer | `digits #` | `1` | Minimum digits required |
| `lowerCaseCharacters` | integer | `lowerCase(#)` | `1` | Minimum lowercase letters |
| `upperCaseCharacters` | integer | `upperCase(#)` | `1` | Minimum uppercase letters |
| `specialCharacters` | integer | `specialChars(#)` | `0` | Minimum special characters |
| `notUsername` | boolean | `notUsername()` | `true` | Cannot match username |
| `notEmail` | boolean | `notEmail()` | `false` | Cannot contain email |
| `regexp` | string | `regex(PATTERN)` | — | Regex pattern match |
| `maxLength` | integer | `maxLength(#)` | — | Maximum password length |
| `passwordHistory` | integer | `historyCount(#)` | `0` | Prevent reuse of last N passwords |
| `forceExpiredPasswordChange` | integer | `expireWeight(#)` | — | Force change after N days |
| `hashIterations` | integer | `hashIterations(#)` | `27500` | PBKDF2 iterations |

### Configuring Password Policy

```bash
# Set multiple policies
curl -X PUT http://localhost:3000/admin/realms/{realm} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "passwordPolicy": "length(12) and digits(2) and upperCase(2) and lowerCase(2) and specialChars(1) and notUsername()"
  }'
```

### Default Policy (Keycloak-compatible format)

```typescript
// Password policy stored in realm settings
const passwordPolicy = "length(8) and digits(1) and lowerCase(1) and upperCase(1) and specialChars(1) and notUsername() and notEmail()";
```

### API Endpoints

```
GET /admin/realms/{realm}
PUT /admin/realms/{realm}
GET /admin/realms/{realm}/password-policy
PUT /admin/realms/{realm}/password-policy
```

---

## MFA Configuration

### TOTP Settings (Time-based One-Time Password)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable TOTP |
| `sortOrder` | integer | `0` | Sort order in UI |
| `digits` | string | `6` | Code length: `6` or `8` |
| `period` | string | `30` | Time step in seconds |
| `algorithm` | string | `HmacSHA1` | Hash algorithm |
| `lookAhead` | string | `1` | Clock skew tolerance |
| `skipInitialSetupUI` | boolean | `false` | Skip TOTP setup screen |

### OTP Policy Configuration

```bash
# Configure TOTP for a realm
curl -X PUT http://localhost:3000/admin/realms/{realm} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "totp": {
      "enabled": true,
      "digits": "6",
      "period": "30",
      "algorithm": "HmacSHA1"
    }
  }'
```

### Conditional MFA

Enable MFA based on authentication context:

```bash
# Require MFA for certain authentication methods
curl -X POST http://localhost:3000/admin/realms/{realm}/authentication/flows/{flow}/executions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "requirement": "REQUIRED",
    "displayName": "OTP Form",
    "authenticationFlow": false,
    "requirementChoices": ["Required", "Alternative"]
  }'
```

### Recovery Codes

Recovery codes are automatically generated when MFA is enabled. Users can regenerate via the Account Console.

### API Endpoints

```
POST /admin/realms/{realm}/users/{userId}/reset-password
POST /admin/realms/{realm}/users/{userId}/execute-actions
GET  /admin/realms/{realm}/users/{userId}/credentials
DELETE /admin/realms/{realm}/users/{userId}/credentials/{credentialId}
```

---

## Brute Force Protection

Brute force protection prevents automated login attacks.

### Protection Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable brute force protection |
| `maxFailureWait` | integer | `900` | Max wait time on failures (seconds) |
| `minimumQuickLoginWait` | integer | `60` | Quick login wait (seconds) |
| `failureFactor` | integer | `30` | Failures before temporary lockout |
| `waitIncrementSeconds` | integer | `60` | Increment per failure (seconds) |
| `quickLoginCheckMilliSeconds` | integer | `1000` | Quick login detection (ms) |

### Lockout Behavior

When `failureFactor` is reached:
1. User account is temporarily disabled
2. Wait time increases: `waitIncrementSeconds × (failures / failureFactor)`
3. Lockout duration: up to `maxFailureWait` seconds
4. Permanent lockout after multiple lockouts requires admin intervention

### API Endpoints

```
GET /admin/realms/{realm}
PUT /admin/realm
DELETE /admin/realms/{realm}/attack-detection/users/{userId}
```

### Clear User Lockout

```bash
curl -X DELETE http://localhost:3000/admin/realms/{realm}/attack-detection/users/{userId} \
  -H "Authorization: Bearer $TOKEN"
```

---

## Event Configuration

### Event Listener Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `eventsEnabled` | boolean | `false` | Enable event storage |
| `eventsExpiration` | long | `2592000` | Event retention (seconds, default 30 days) |
| `eventsListeners` | string[] | `["jboss-logging"]` | Event listener implementations |

### Enabled Events

Configure which events are stored:

| Event Type | Description |
|------------|-------------|
| `LOGIN` | User login |
| `LOGIN_ERROR` | Failed login attempt |
| `LOGOUT` | User logout |
| `REGISTER` | User registration |
| `REGISTER_ERROR` | Failed registration |
| `REFRESH_TOKEN` | Token refresh |
| `CODE_TO_TOKEN` | Code exchange |
| `CLIENT_LOGIN` | Client authentication |
| `USER_INFO_REQUEST` | UserInfo endpoint access |

### Configuring Events

```bash
# Enable event storage
curl -X PUT http://localhost:3000/admin/realms/{realm} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventsEnabled": true,
    "eventsExpiration": 2592000,
    "eventsListeners": ["jboss-logging", "idenplane-events"]
  }'
```

### Admin Events

Admin events capture management operations:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adminEventsEnabled` | boolean | `false` | Enable admin event logging |
| `adminEventsDetailsEnabled` | boolean | `false` | Include object representation |

```bash
# Enable admin events
curl -X PUT http://localhost:3000/admin/realms/{realm} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adminEventsEnabled": true,
    "adminEventsDetailsEnabled": true
  }'
```

### API Endpoints

```
GET /admin/realms/{realm}/events
DELETE /admin/realms/{realm}/events
GET /admin/realms/{realm}/admin-events
GET /admin/realms/{realm}/events/config
PUT /admin/realms/{realm}/events/config
```

---

## Client Scopes

Client scopes define reusable sets of OAuth scopes.

### Standard Scopes

| Scope | Description | Claims |
|-------|-------------|--------|
| `openid` | OpenID Connect authentication | `sub` |
| `profile` | User profile information | `name`, `family_name`, `given_name`, `preferred_username`, `picture` |
| `email` | Email address | `email`, `email_verified` |
| `phone` | Phone number | `phone_number`, `phone_number_verified` |
| `address` | Physical address | `address` |
| `offline_access` | Offline session access | `refresh_token` |

### Client Scope Management

```bash
# Get all client scopes
curl http://localhost:3000/admin/realms/{realm}/client-scopes \
  -H "Authorization: Bearer $TOKEN"

# Create custom scope
curl -X POST http://localhost:3000/admin/realms/{realm}/client-scopes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "custom-scope",
    "description": "Custom scope for my application",
    "protocol": "openid-connect"
  }'
```

### Scope-to-Client Assignment

```bash
# Add scope to client
curl -X POST http://localhost:3000/admin/realms/{realm}/clients/{clientId}/default-client-scopes/{scopeId}

# Remove scope from client
curl -X DELETE http://localhost:3000/admin/realms/{realm}/clients/{clientId}/default-client-scopes/{scopeId}
```

---

## Role Configuration

### Default Roles

| Role | Description |
|------|-------------|
| `default-roles-{realm}` | Base role assigned to all users |
| `offline_access` | Offline session access |
| `uma_authorization` | UMA permission management |

### Creating Roles

```bash
# Create realm role
curl -X POST http://localhost:3000/admin/realms/{realm}/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "admin",
    "description": "Administrator role",
    "composite": true,
    "clientRole": false
  }'

# Create client role
curl -X POST http://localhost:3000/admin/realms/{realm}/clients/{clientId}/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "editor",
    "description": "Content editor role",
    "clientRole": true
  }'
```

### Composite Roles

Combine multiple roles into a composite:

```bash
# Create composite role
curl -X POST http://localhost:3000/admin/realms/{realm}/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "content-manager",
    "composite": true
  }'

# Add child roles (using realm role ID)
curl -X POST http://localhost:3000/admin/realms/{realm}/roles-by-id/{roleId}/composites \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '["editor", "publisher"]'
```

---

## User Federation

### LDAP Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `priority` | integer | `0` | Provider priority |
| `name` | string | — | Provider name |
| `providerName` | string | `ldap` | Provider type |
| `vendor` | string | — | LDAP vendor (Active Directory, Red Hat Directory Server, etc.) |
| `usernameLDAPAttribute` | string | `cn` | LDAP attribute for username |
| `rdnLDAPAttribute` | string | `cn` | RDN LDAP attribute |
| `uuidLDAPAttribute` | string | `objectGUID` | UUID LDAP attribute |
| `userObjectClasses` | string | `inetOrgPerson` | Object classes for user entries |
| `connectionUrl` | string | — | LDAP server URL |
| `usersDn` | string | — | Base DN for user searches |
| `bindDn` | string | — | Service account DN |
| `bindCredential` | string | — | Service account password |

### Kerberos Integration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keyTab` | string | — | Kerberos keytab file path |
| `serverPrincipal` | string | — | Kerberos server principal |
| `allowKerberos` | boolean | `false` | Enable Kerberos authentication |
| `debug` | boolean | `false` | Enable debug logging |

---

## Webhook Configuration

Configure webhooks to receive notifications about Idenplane events.

### Webhook Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | — | Webhook endpoint URL |
| `events` | string[] | — | Events to send (e.g., `LOGIN`, `USER_CREATED`) |
| `secret` | string | — | HMAC signing secret |
| `enabled` | boolean | `true` | Enable/disable webhook |
| `retryAttempts` | integer | `3` | Number of retry attempts |
| `timeout` | integer | `5000` | Request timeout (ms) |

### Supported Events

| Event | Trigger |
|-------|---------|
| `LOGIN` | Successful user login |
| `LOGIN_ERROR` | Failed login attempt |
| `LOGOUT` | User logout |
| `REGISTER` | New user registration |
| `USER_UPDATED` | User profile update |
| `USER_DELETED` | User deleted |
| `PASSWORD_RESET` | Password reset requested |
| `MFA_ENABLED` | MFA enabled |
| `MFA_DISABLED` | MFA disabled |
| `CLIENT_CREATED` | New OAuth client created |
| `CLIENT_UPDATED` | OAuth client updated |
| `ROLE_ASSIGNED` | Role assigned to user |

### Registering Webhooks

```bash
curl -X POST http://localhost:3000/admin/realms/{realm}/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhooks/idenplane",
    "events": ["LOGIN", "LOGOUT", "USER_CREATED"],
    "secret": "your-webhook-secret",
    "enabled": true
  }'
```

### Verifying Webhooks

Idenplane signs webhook payloads using HMAC-SHA256:

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expected}`)
  );
}
```

---

## Default Values Reference

Here's a summary of all default values for reference:

```typescript
const defaultRealmConfig = {
  // Security
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  resetPasswordAllowed: true,
  editUsernameAllowed: false,
  bruteForceProtected: true,

  // Sessions & Tokens
  ssoSessionIdleTimeout: '30m',
  ssoSessionMaxLifespan: '8h',
  offlineSessionIdleTimeout: '30d',
  accessTokenLifespan: '5m',
  accessTokenLifespanImplicit: '15m',
  refreshTokenLifespan: '1h',

  // OAuth
  oauth2DeviceCodeLifespan: '600s',
  oauth2DevicePollingInterval: '5s',

  // Brute Force
  failureFactor: 30,
  maxFailureWait: 900,
  waitIncrementSeconds: 60,

  // Events
  eventsEnabled: false,
  adminEventsEnabled: false,

  // Themes
  loginTheme: 'idenplane',
  accountTheme: 'idenplane',
  adminTheme: 'idenplane',
  emailTheme: 'idenplane',
};
```

---

## Configuration via SDK

### TypeScript SDK Configuration

```typescript
import { IdenplaneClient } from '@idenplane/sdk';

// Realm configuration
const client = new IdenplaneClient({
  baseUrl: 'https://auth.example.com',
  realm: 'my-realm',
});

// Get current realm config
const realm = await client.realms.get('my-realm');

// Update realm settings
await client.realms.update('my-realm', {
  registrationAllowed: true,
  passwordPolicy: 'length(12) and digits(2)',
});

// Configure TOTP
await client.realms.update('my-realm', {
  totpPolicy: {
    enabled: true,
    digits: '6',
    period: '30',
  },
});
```

---

## Next Steps

<div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem'}}>

[**Environment Variables**](/docs/configuration/environment-variables)
Environment-based configuration reference

[**Admin API**](/docs/api/realms)
Manage realms programmatically

[**Deployment**](/docs/deployment/docker)
Deploy with Docker Compose

</div>

---

<p align="center">
  <a href="https://idenplane.dev">idenplane.dev</a> &middot;
  <a href="https://github.com/idenplane/idenplane">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>