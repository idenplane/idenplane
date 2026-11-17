---
id: admin-mfa
title: Admin console MFA
description: Second factor for admin console sign-in, the server-wide requirement, recovery codes, break-glass with the admin API key, and recent-MFA checks on sensitive admin actions
---

# Admin console MFA

Since 0.11.0 the admin console asks for a second factor once an admin has one. A server-wide setting can require one for every admin; new installs start with it on. This page covers how it works and why it was built this way. It also covers what changes for an existing install and what to do when an admin is locked out.

Before 0.11.0, a stolen admin password was enough to take full control of every realm. That was the top gap in the [ASVS assessment](./asvs-assessment.md) (V6.3.3) and the [threat model](./threat-model.md).

## Summary

| | |
|---|---|
| Factors | An authenticator app (TOTP) and passkeys (WebAuthn). Recovery codes are the fallback. SMS is not accepted for the console. |
| When is it asked for | At every console sign-in, once the admin has a factor. |
| Requirement | The **Require MFA for all admins** setting, or the `ADMIN_MFA_REQUIRED` environment variable. It is on for new installs and off after an upgrade. |
| Without a factor while required | The admin can sign in, but can only enrol a factor. Every other admin API call is refused with `403 admin_mfa_enrolment_required`. |
| Token | The admin token records `amr`, `acr` and `auth_time`. |
| Sensitive actions | These need an MFA check from the last 15 minutes: removing a factor, new recovery codes, resetting another admin's MFA, turning the requirement off, resetting an end user's MFA and unlocking a user. |
| Break-glass | The `ADMIN_API_KEY` is not affected. It can reset an admin's MFA, and every reset is recorded as an admin event. |

## The admin's factors are the account's factors

Admins are users of the `master` realm, so admin MFA uses the same credentials as that account:

- **TOTP** is the user's `totp` credential. It uses the same replay protection as end-user sign-in: a code can be used once in its window, enforced by a unique index.
- **Passkeys** are the user's WebAuthn credentials in the master realm.
- **Recovery codes** are the user's recovery codes.

So an admin who has already set up TOTP for the master account (in the account console) is asked for that code at console sign-in from 0.11.0. There is no second set of credentials to keep in step.

SMS codes are not accepted for the console. SIM swaps and SS7 interception make SMS the weakest factor, and it should not protect the account that controls every realm (ASVS V6.6.1 L3).

### Passkeys for the console

The console registers its passkeys under its own relying party. The realm's passkey switch has no effect on them: `master` does not need `webAuthnEnabled`.

- **RP ID:** `ADMIN_WEBAUTHN_RP_ID`, else the master realm's WebAuthn RP ID, else the host name of `BASE_URL`.
- **Allowed origins:** `ADMIN_WEBAUTHN_ORIGINS` (comma-separated), else the origin of `BASE_URL`.

Set these when the console is reached on a host name other than `BASE_URL`.

Each challenge is bound to the sign-in that asked for it. A passkey that belongs to another account is refused before its signature is checked.

## Sign-in

```
POST /admin/auth/login {username, password}
  ├─ no factor, MFA not required ─▶ 200 {access_token}                      (as before)
  ├─ no factor, MFA required ─────▶ 200 {access_token, mfa_enrolment_required: true}
  │                                  token: amr ["pwd"], enrolment only
  └─ has a factor ────────────────▶ 200 {mfa_required: true, mfa_token, methods}
                                     no access token, no cookie

POST /admin/auth/login/mfa {mfa_token, method: totp|recovery, code}  ─▶ 200 {access_token}
POST /admin/auth/login/passkey/options {mfa_token}                   ─▶ WebAuthn request options
POST /admin/auth/login/passkey {mfa_token, response}                 ─▶ 200 {access_token}
```

The `mfa_token` is a one-time pending action of its own type, `admin_mfa_challenge`. Only its SHA-256 is stored. The hosted login pages cannot use it, and the console cannot use theirs. It expires after 5 minutes and allows 5 answers. Each answer spends one attempt atomically before the code is checked, so parallel guesses cannot get more.

**Brute force.** Before each answer is checked, the account lockout and the per-user second-factor limit are checked. A wrong code is counted in the master realm's brute-force counter (the TOTP failure tracker, with the realm's limits) and recorded as an `MFA_VERIFY_ERROR` login event. A correct password alone no longer clears the failure counter; only a completed sign-in does.

## Requiring MFA for every admin

### The setting

The requirement is a server-wide setting, stored in its own table (`admin_security_policy`). The environment variable `ADMIN_MFA_REQUIRED` can fix it.

| `ADMIN_MFA_REQUIRED` | Effect |
|---|---|
| unset | The stored setting decides. A super-admin changes it on **Admin accounts → MFA**, or with `PUT /admin/admin-mfa/policy`. |
| `true` | Required. The console shows it as set by the server, and it cannot be turned off there. |
| `false` | Not required, whatever is stored. Use this only to recover a broken install. |

**Why a setting of its own, not the master realm's `mfaRequired`.** The master realm's `mfaRequired` also controls the hosted login pages of the master realm, and so every OIDC client that signs in there. Reusing it would change two things with one switch.

**Why a stored setting and an environment variable.** The stored setting can be changed in the console, takes effect at once, and is recorded as an admin event. It is also how new installs can start with the requirement on while upgraded installs keep their old behaviour. The environment variable is for operators who manage configuration as code. With it set to `true`, a stolen super-admin session cannot turn the requirement off.

### On for new installs

The first start of a new install creates the setting with the requirement on. The exception is `DEMO_MODE=true`, where visitors share a demo account.

The first admin signs in with the initial password and goes straight to enrolment. Nothing else in the console works until a factor is set up.

### Off after an upgrade

The migration creates the table and writes no row, and no row means "not required". After an upgrade, admins sign in as before until they enrol a factor or a super-admin turns the requirement on.

### The enrolment path: nobody is locked out

When MFA is required, an admin with no factor still gets a token at sign-in. That token is marked password-only (`amr: ["pwd"]`), and it only reaches these routes:

- `GET /admin/auth/me` and `GET /admin/auth/mfa`;
- enrolling a first TOTP or passkey;
- signing out.

Every other admin route answers `403` with `code: "admin_mfa_enrolment_required"`. The console then opens the enrolment page.

Once the factor is activated, the response carries a new token with MFA claims, and the password-only token is revoked.

The check runs on every request, from the database, like the role check. Turning the requirement on applies to the next request of every admin, not to their next sign-in.

**Residual risk.** An attacker who has the password of an admin with no factor, while MFA is required, can enrol their own factor. Every identity provider with a grace enrolment has this risk. To limit it:

- enrolment is recorded as an admin event, and the super-admin's MFA list shows who has no factor;
- an admin who already has a factor can only add another after a recent MFA check;
- operators should have admins enrol soon after turning the requirement on.

### Password-only tokens of admins who have a factor

An admin with a factor can still hold a token without MFA claims: one issued before the upgrade, or before they enrolled. Such a token reaches only `me`, the MFA status and step-up. Everything else answers `403 admin_mfa_step_up_required`. So enrolling a factor also confines any stolen password-only session.

## The admin token

Admin tokens issued after a sign-in or a step-up carry these claims:

| Claim | Value |
|---|---|
| `amr` | RFC 8176 methods: `["pwd"]`; with TOTP `["pwd","otp","mfa"]`; with a passkey `["pwd","hwk","mfa"]`; with a recovery code `["pwd","mfa"]` |
| `acr` | `urn:idenplane:acr:password`, `urn:idenplane:acr:mfa` (TOTP or recovery code) or `urn:idenplane:acr:webauthn` (passkey) |
| `auth_time` | When the factors were last checked (sign-in or step-up) |

A token without these claims, such as one issued by an older version, counts as password-only. Sessions created with the API key carry none of them; the API key is not a user.

## Recent MFA for sensitive actions (step-up)

Some actions need the admin's factor checked in the last **15 minutes**. The check uses `acr` at MFA level or higher and an `auth_time` no older than 15 minutes:

- removing a TOTP or passkey, and new recovery codes;
- adding a factor when the admin already has one;
- resetting another admin's MFA;
- turning the requirement off;
- resetting an end user's MFA (`DELETE /admin/realms/{realm}/users/{id}/mfa...`) and unlocking a user (`.../brute-force/users/{id}/unlock`).

A route declares the check with `@RequireRecentAdminMfa()`. `AdminAuthorizationGuard` enforces it and refuses with `403 admin_recent_mfa_required`. The console then asks for a code, calls step-up and retries.

```
POST /admin/auth/step-up {method: totp|recovery, code}  ─▶ {access_token}  (new auth_time; the old token is revoked)
POST /admin/auth/step-up/passkey/options                ─▶ WebAuthn request options
POST /admin/auth/step-up/passkey {response}             ─▶ {access_token}
```

Step-up uses the same brute-force accounting as sign-in.

**What this replaces.** The end-user MFA reset and the unlock route already asked for an MFA step-up. But they looked for a step-up on the admin's hosted-login SSO session, through a cookie scoped to `/realms/{realm}` that the console never sends. In practice only the API key could reach them, and those routes refuse the API key. They now also accept a recent-MFA admin token, which the console can obtain. Their refusal of the API key is unchanged; see below.

## Recovery codes

Each admin gets ten one-time recovery codes when they enrol their first factor. The console shows them once. **New recovery codes** replaces them all, and needs a recent MFA check.

### Stronger codes for everyone (ASVS V6.5.2)

The ASVS assessment found the old codes weak: 8 hex characters (32 bits), stored as unsalted SHA-256. Anyone with a copy of the database could reverse all of them in seconds.

From 0.11.0, recovery codes for admins and end users are:

- **120 bits** from the CSPRNG: 24 base32 characters, shown as `xxxxxx-xxxxxx-xxxxxx-xxxxxx`. Case, spaces and dashes are ignored when a code is entered.
- **Stored as `rc2$` + SHA-256.** ASVS allows a standard hash for lookup secrets of 112 bits or more, because they cannot be enumerated. A keyed hash (HMAC under `ENCRYPTION_KEY`) was ruled out: these codes can live for years, and they would stop working after a key rotation.
- **Single use**, enforced by a conditional update.

### Codes issued before 0.11.0

These codes keep working, so nobody loses their way back in. Their stored hashes are protected in the background:

- After start-up, `RecoveryCodeRewrapService` replaces each unused old hash with `rc1a$` + Argon2id(old hash): salted and slow. Old instances may still issue old codes during a rolling upgrade, so it runs at every start. It only reads rows that are not yet rewrapped.
- A code is checked against its plain old hash or its rewrapped hash. Only input in the old 8-hex shape is checked against the rewrapped hashes, so a random guess costs no Argon2 work.
- The admin's MFA page and the super-admin's admin list flag **old-format recovery codes**, and the MFA page offers new ones. `GET /admin/upgrade/health` counts every user (admin or not) who still has them. End users get new-format codes the next time codes are issued to them.

## Break-glass: the admin API key

The `ADMIN_API_KEY` path is unchanged. It is not a user, has no factor, and is never confined by the MFA requirement. Keep it in a secrets manager and use it as break-glass.

**The API key can reset an admin's MFA:**

```
DELETE /admin/admin-accounts/{userId}/mfa    (x-admin-api-key: …)
```

This removes the admin's TOTP, passkeys and recovery codes, and signs the admin out everywhere: every console token they hold stops working at once (since 0.12.0), and their master realm sessions end. The admin then signs in with their password and enrols again; if MFA is required, the enrolment path applies.

**How console tokens are ended.** Console tokens are stateless JWTs, revoked one at a time by their `jti`. A reset also records a per-admin revocation time (a `user:<id>` row in `admin_revoked_tokens`, kept for one token lifetime), and a console token of that admin issued before it is refused. The check is part of the revocation lookup every console request already makes, so it costs no extra query. Because a token's issue time has whole-second precision, a token issued in the same second as the reset is refused too; signing in again a second later works. The same applies when an admin's password is set (`PUT /admin/realms/master/users/{id}/reset-password`), when the account is disabled, or when an admin signs a master realm user out of all sessions.

**Why the API key may reset an admin's MFA but not an end user's.** `src/mfa/mfa.controller.ts` deliberately refuses the API key for end-user MFA resets. Its reason is that a leaked key must not let anyone bypass MFA on every end-user account. The admin case is different:

- the key is already super-admin;
- it can already reset an admin's password (`PUT /admin/realms/master/users/{id}/reset-password`) or create a new super-admin.

Letting it reset an admin's factor gives it no power it does not already have. Refusing would leave a single-admin install with no way back after a lost phone. The end-user rule stays as it was.

**Audit.** These actions are recorded as admin events in the master realm (`resourceType: ADMIN_MFA`):

- every enrolment and removal of a factor;
- new recovery codes;
- every reset, whether by a super-admin or by the API key;
- every change of the requirement.

They are recorded even when the master realm has admin events turned off. Each is also logged at `warn`. The event records who did it (an admin id or `api-key:admin`), the target and the IP address, but never a code or secret.

**Other ways back in:**

- another super-admin resets your MFA (with their own recent MFA check);
- you use one of your recovery codes;
- an operator with database access deletes your rows in `user_credentials` (type `totp`), `webauthn_credentials` and `recovery_codes`.

## Turning it on after an upgrade

1. Each admin opens **Two-factor** in the console header (`/console/mfa`) and sets up an authenticator app or a passkey, then saves the recovery codes.
2. A super-admin checks **Admin accounts**: every admin should show a second factor.
3. The super-admin turns on **Require a second factor for every admin** on the same page, or sets `ADMIN_MFA_REQUIRED=true` and restarts.

Admins who have not enrolled by then are not locked out: their next request takes them to the enrolment page.

## Super-admin view

**Admin accounts** lists every admin with their factors: authenticator app, number of passkeys, and recovery codes left, flagged if they are old-format. Admins without a factor are highlighted. A super-admin can reset an admin's MFA from there, and change the requirement.

## What is not covered

- **Phishing-resistant MFA only (L3).** Passkeys are offered, but TOTP is also accepted. There is no switch to require passkeys yet.
- **The command-line tool** (`idenplane login`, `idenplane init`) asks for a TOTP or recovery code when the admin has one, but cannot use a passkey; use `--api-key` or a TOTP for scripts.
- **End-user account console.** The stronger recovery codes apply there too, but adding or removing a factor in the end-user account console still needs only the session (ASVS V7.5.1).
