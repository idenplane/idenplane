---
id: secure-defaults
title: Secure defaults
description: The security settings a new realm starts with, why, and how to apply them to realms created before 0.10.0
---

# Secure defaults

Since 0.10.0 a **new** realm starts with brute-force protection and audit events on. This page lists every security-relevant default, what it is, and why.

:::warning Realms created before 0.10.0 are not changed
An upgrade changes only the defaults for realms created afterwards. A realm that had brute-force protection or event recording off keeps it off. See [Turning it on for an existing realm](#turning-it-on-for-an-existing-realm).
:::

"New realm" means every way a realm is created:

- the admin API (`POST /admin/realms`) and the admin console;
- a realm import whose file does not set the field (a file that sets it, even to `false`, is imported as written);
- the setup wizard;
- the `master` realm, created on the first start against an empty database.

The values live in one place, `src/realms/realm-security-defaults.ts`. They are also the database column defaults, and a unit test fails if the two drift apart.

## Brute-force protection

| Setting | Default for new realms | Before 0.10.0 |
|---|---|---|
| `bruteForceEnabled` | `true` | `false` |
| `maxLoginFailures` | `10` | `5` |
| `failureResetTime` (seconds) | `900` (15 minutes) | `600` |
| `lockoutDuration` (seconds) | `300` (5 minutes) | `900` |
| `permanentLockoutAfter` | `0` (never) | `0` |

### How the lockout works

- Each failed password or LDAP bind counts as a failure: on the hosted login page, the password grant, device approval and admin console sign-in. Failed TOTP codes and passkey assertions are counted separately, with the same limits.
- When `maxLoginFailures` failures fall within `failureResetTime`, the account is locked for `lockoutDuration`.
- **While the account is locked, the password is not checked at all.** The answer is the same whether the password was right or wrong, so a locked account can't be used to test passwords. Attempts during the lock are not counted and don't extend it.
- The lock ends by itself. A successful sign-in afterwards clears the failures.
- **The lockout is progressive.** The failures stay counted for the whole `failureResetTime` window. If the next attempt after a lock is wrong, the account locks again at once. After the first 10 guesses an attacker gets about one guess every 5 minutes per account (roughly 300 a day), not another 10.
- Every lockout is written to the server log at `warn` level. The user gets an email if the realm can send email.

### The trade-off: lockout as a denial of service

A per-account lockout limits password guessing, but anyone who knows a username can also use it to keep that user out. The defaults keep that cost low:

- **Temporary, not permanent.** `permanentLockoutAfter` is `0`. A permanent lockout **disables** the account, which would let an attacker switch off any account, including an administrator's, for good. It is still available, and the console warns when you set it.
- **Short.** Five minutes, so an attacker has to keep sending requests to keep a user out. That traffic is visible in the login events and the log, and the per-IP rate limits can stop it.
- **Ten failures, not five.** Fewer accidental lockouts from mistyped passwords. NIST SP 800-63B allows up to 100.

What remains, and what to do about it:

- **Targeted lockout of a known username stays possible.** For high-value accounts, prefer passkeys or MFA, so the password alone is not what protects the account. Turn on [rate limiting](#other-defaults) and CAPTCHA for public realms.
- **Unlocking a user.** An admin can unlock a user from the console (the dashboard's **Locked users** panel) or with `POST /admin/realms/{realm}/brute-force/users/{userId}/unlock`. That route asks for an MFA step-up, so it refuses the admin API key. Setting a new password also unlocks the account (below).
- **A locked administrator.** The `master` realm is covered too. Wait for the lock to end (5 minutes), sign in as another super-admin, or, with the `ADMIN_API_KEY`, set a new password, which also clears the lock:

  ```bash
  # Find the admin's id, then set a new password (this also unlocks the account).
  curl -H "x-admin-api-key: $ADMIN_API_KEY" \
    "https://idp.example.com/admin/realms/master/users?username=admin"
  curl -X PUT -H "x-admin-api-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
    -d '{"password": "<new password>"}' \
    "https://idp.example.com/admin/realms/master/users/{userId}/reset-password"
  ```

  Keep `permanentLockoutAfter` at `0` on `master`: a permanent lockout disables the account, and only another super-admin or the API key can bring it back.

### Turning it on for an existing realm

In the console, open the realm's **Security** settings. A warning shows while brute-force protection is off. Tick **Enable brute force protection** and save.

With the API:

```bash
curl -X PATCH "https://idp.example.com/admin/realms/my-realm" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bruteForceEnabled": true, "maxLoginFailures": 10, "failureResetTime": 900, "lockoutDuration": 300, "permanentLockoutAfter": 0}'
```

To find the realms that still have it off, call `GET /admin/upgrade/health` (super-admin). The `brute_force_protection` check is a warning that names them. It never fails the health check, so it does not block an upgrade.

## Audit events

| Setting | Default for new realms | Before 0.10.0 |
|---|---|---|
| `eventsEnabled` (sign-in events) | `true` | `false` |
| `adminEventsEnabled` (admin changes) | `true` | `false` |

Without events there is no record of failed sign-ins or of who changed what. Retention is bounded: `loginEventRetentionDays` (30) and `adminEventRetentionDays` (90). Existing realms keep their setting; turn it on in the realm settings or with `PATCH /admin/realms/{realm}` and `{"eventsEnabled": true, "adminEventsEnabled": true}`.

## Redirect URIs

Since 0.11.0 redirect URIs and post-logout redirect URIs match **exactly** (RFC 9700, OAuth 2.1, ASVS 5.0 V10.4.1). The only exception is the port of a loopback IP redirect URI (`http://127.0.0.1/...`, `http://[::1]/...`), which may be any port for native apps (RFC 8252 §7.3). Fragments are refused.

Before 0.11.0 a registered URI ending in `/*` matched any path below it, so any page there (an open redirect, user content, a compromised subpath) could receive authorization codes.

| | Behaviour |
|---|---|
| New clients | Exact matching. The admin API, console, setup wizard and realm import refuse a `/*` entry. |
| Existing clients without a `/*` entry | Exact matching from the upgrade. Exact entries matched exactly before too, so nothing changes for them. |
| Existing clients with a `/*` entry | The upgrade turns on `allowInsecureWildcardRedirectUris` for them, so they keep working as before. |
| Keycloak imports, realm exports from before 0.11.0 | Same as the upgrade: a client with a `/*` entry gets the opt-in, and the import reports it. |

**Why the upgrade keeps wildcard clients working instead of breaking them.** Turning wildcards off on upgrade would break sign-in for every such application at once, and the operator would find out from their users. Rejecting wildcards entirely would leave no way to upgrade first and fix the clients after. So the insecure behaviour stays only where it already was, behind a per-client flag whose name says what it is, and the upgrade makes it visible: `GET /admin/upgrade/health` reports the `wildcard_redirect_uris` warning naming each such client, and the console shows a warning on the client until the flag is off. No new client can get a wildcard without setting the flag explicitly through the API.

**To fix a client:** register each exact callback URL the application sends, then turn **Allow insecure wildcard redirect URIs** off in the console, or `PUT /admin/realms/{realm}/clients/{clientId}` with the exact `redirectUris` and `"allowInsecureWildcardRedirectUris": false`. See [Redirect URI matching](../api/clients.md#redirect-uri-matching).

Forward-auth return URLs (`allowedRedirectUris` of a proxy application) keep `/*` prefix matching: they are not OAuth redirect URIs, no code or token is sent there, and the browser only returns to the page it asked for.

## Other defaults

Each default below was reviewed against the rule: change it only when it is clearly right and affects new realms or clients alone, without breaking a typical integration.

| Setting | Default | Decision |
|---|---|---|
| PKCE for public clients | Always required, `S256` only | Already enforced in code; no setting. |
| Refresh token rotation | Always on; reuse of a rotated token revokes the session | Already enforced in code. |
| Implicit flow | Not supported (`response_type=code` only) | — |
| New client type and grants | `CONFIDENTIAL`, `authorization_code` only | Kept. |
| Initial admin password | Random 24-byte password when `ADMIN_PASSWORD` is unset; weak values refused in production | Kept. |
| `passwordMinLength` | `8` | Kept: meets ASVS 5.0 V6.2.1. Consider 12 or more for admin realms. |
| Password composition rules | Off | Kept off on purpose (ASVS 5.0 V6.2.5, NIST). |
| `passwordMaxAgeDays` | `0` (no forced rotation) | Kept (ASVS 5.0 V6.2.10). |
| `accessTokenLifespan` | 300 s | Kept. |
| `refreshTokenLifespan` | 1800 s; also the lifetime of an OAuth session, checked at every refresh | Kept. |
| `offlineTokenLifespan` | 30 days; the lifetime of an offline session, counted from sign-in (since 0.11.0; before, offline sessions got `refreshTokenLifespan`) | Kept. Offline tokens are still ended by sign-out everywhere, a password reset or change, an admin or a SCIM client setting the password, an admin removing second factors, disabling or deleting the user, SCIM deactivation and the admin "sign out all sessions". |
| `maxSessionsPerUser` | 10; offline sessions don't count (since 0.12.0) | Kept. |
| `ssoSessionIdleTimeout` | `0` (off), since 0.12.0 | **Recommended when you raise `refreshTokenLifespan`, not changed.** With the default 30-minute maximum lifetime it adds little; on by default it would sign out users of realms configured for long sessions at the upgrade. See [Idle timeout](../configuration/options.md#idle-timeout). |
| `rateLimitEnabled` | Off | **Recommended on, not changed.** The default per-IP limit (20 per minute) can block many users behind one NAT or a misconfigured `TRUSTED_PROXIES`. Turn it on after checking `TRUSTED_PROXIES` and the limits. |
| `requireEmailVerification` | Off | **Recommended on where email is configured, not changed.** It needs working SMTP; on by default it would block every sign-up on a new realm without email. |
| `mfaRequired` | Off | **Recommended for realms with sensitive data, not changed.** It forces every user to enrol on first sign-in. |
| MFA for admins | Not available for console sign-in | **Gap.** See the [ASVS assessment](./asvs-assessment.md#remaining-gaps) (V6.3.3). |
| `registrationAllowed` | On | **Recommended off for workforce and B2B realms, not changed.** Self-registration is a product choice, and changing it would surprise realms created through the API. |
| `captchaEnabled` | Off | Needs provider keys. Recommended for public realms with registration. |
| `requireConsent` (client) | Off | Recommended on for third-party clients. |
| `webAuthnUserVerificationRequired` | Off | Recommended on when passkeys are the only factor. |
| `smtpSecure` | Off (STARTTLS when the server offers it) | Recommended: use port 465 with `smtpSecure`, or a server that always offers STARTTLS. |
| `adaptiveAuthEnabled` | Off | Keep off unless needed: its geo-IP lookup sends user IPs to ip-api.com over plain HTTP (ASVS 5.0 V12.3.1). |
| `impersonationEnabled` | Off | Kept. |
| `permanentLockoutAfter` | `0` | Kept: see the trade-off above. |
