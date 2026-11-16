---
id: asvs-assessment
title: OWASP ASVS 5.0 self-assessment
description: Idenplane assessed against OWASP ASVS 5.0.0 Level 2, requirement by requirement, with evidence from the code
---

# OWASP ASVS 5.0 self-assessment

This is a self-assessment of the Idenplane server, admin console and themes against the [OWASP Application Security Verification Standard 5.0.0](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release), **Level 2**. It covers every Level 1 and Level 2 requirement (253), taken from the official release CSV.

- **Version assessed:** 0.10.0 (branch `feat/security-hardening-0.10`), November 2026. Rows changed by 0.11.0 (V3.7.2, V7.1.1, V7.3.2, V10.4.1, V10.4.8) are updated and say "FIXED in 0.11.0".
- **Method:** each verdict comes from reading the code, not the docs. Evidence is a file and line, a test, or configuration. Requirements about documentation were judged against what the docs actually say.
- **Not a certification.** Nobody outside the project has reviewed it. Treat it as a map of where the controls are and where they are missing.
- **Machine-readable copy:** [asvs-5.0-l2-assessment.csv](pathname:///security/asvs-5.0-l2-assessment.csv), one row per requirement with the requirement text, status, evidence, notes and recommendation.
- **Attribution:** the requirement identifiers and text are from the OWASP Application Security Verification Standard 5.0.0, © OWASP Foundation, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The CSV reproduces that text under the same licence.

## Status meanings

| Status | Meaning |
|---|---|
| Pass | The code meets the requirement on every relevant path. |
| Partial | Some paths or parts are covered, or the control exists but depends on configuration. |
| Fail | The requirement is not met. |
| N/A | The requirement does not apply to Idenplane (the reason is given). |

Idenplane terminates TLS at a reverse proxy, so transport requirements about the server's own certificate are judged N/A, with a note on what the proxy must do. GraphQL is not mounted (nothing imports `GraphQLAdminModule`, and a fitness test fails if it becomes reachable), so the GraphQL requirements are N/A.

## Summary

| Chapter | Pass | Partial | Fail | N/A | Total |
|---|---:|---:|---:|---:|---:|
| V1 Encoding and Sanitization | 13 | 6 | 0 | 8 | 27 |
| V2 Validation and Business Logic | 2 | 7 | 1 | 1 | 11 |
| V3 Web Frontend Security | 12 | 5 | 1 | 1 | 19 |
| V4 API and Web Service | 4 | 3 | 1 | 2 | 10 |
| V5 File Handling | 4 | 2 | 3 | 0 | 9 |
| V6 Authentication | 17 | 11 | 6 | 1 | 35 |
| V7 Session Management | 8 | 9 | 1 | 0 | 18 |
| V8 Authorization | 5 | 2 | 0 | 0 | 7 |
| V9 Self-contained Tokens | 6 | 1 | 0 | 0 | 7 |
| V10 OAuth and OIDC | 12 | 11 | 1 | 5 | 29 |
| V11 Cryptography | 10 | 3 | 1 | 0 | 14 |
| V12 Secure Communication | 2 | 3 | 1 | 3 | 9 |
| V13 Configuration | 4 | 9 | 0 | 0 | 13 |
| V14 Data Protection | 1 | 6 | 2 | 0 | 9 |
| V15 Secure Coding and Architecture | 6 | 5 | 2 | 0 | 13 |
| V16 Security Logging and Error Handling | 8 | 6 | 1 | 1 | 16 |
| V17 WebRTC | 0 | 0 | 0 | 7 | 7 |
| **All** | **114** | **89** | **21** | **29** | **253** |

### Fixed in this release

The assessment found these gaps and 0.10.0 closes them, with tests:

| Requirement | Fix | Test |
|---|---|---|
| V6.3.1, V2.4.1 | Brute-force protection is on for new realms, with a temporary, progressive lockout. See [secure defaults](./secure-defaults.md). | `test/secure-realm-defaults.e2e-spec.ts`, `src/realms/realm-security-defaults.spec.ts` |
| V6.3.1 | The password grant checked an LDAP user's password before the lockout, so a locked account answered differently for the right password. The lockout is now checked first on every path, and failed LDAP binds count. | `auth.service.spec.ts` "a locked account" |
| V16.3.1 | Login and admin events are recorded for new realms. | `realms.service.spec.ts` |
| V16.3.3 | Every temporary lockout is logged, not only permanent ones. | — |
| V9.2.2, V10.3.1 | userinfo, introspection and the session-events WebSocket accepted any JWT the realm signed, including ID tokens, logout tokens and (in master) admin tokens. They now accept only access tokens. | `tokens.service.spec.ts`, `session-events.gateway.spec.ts` |
| V7.4.3 | A password reset ends every SSO and OAuth session of the user and revokes the refresh tokens. | `test/theme-views.e2e-spec.ts` |
| V6.3.4, V7.4.2 | A user disabled after approving a device, or after signing in but before the code exchange, no longer gets tokens. | `auth.service.spec.ts` "refuses tokens to a user disabled…" |
| V1.2.1 | The lockout email put the raw username and realm name into HTML. | `brute-force.service.spec.ts` "escapes the username" |
| V5.2.3 | A compressed SAMLRequest was inflated without a limit before the size check (decompression bomb). | `saml-idp.service.spec.ts` "decompression bomb" |
| V15.3.2 | Back-channel logout and audit-stream deliveries followed redirects. | `backchannel-logout.service.spec.ts`, `audit-streams.service.spec.ts` |
| V13.4.5, V16.5.1 | The public `/health/ready` returned the database driver's error text. | `prisma-health.indicator.spec.ts` |
| V6.1.1, V7.1.1 | The brute-force and session docs described Keycloak settings that do not exist. | — |
| V11.1.2 | A cryptographic inventory now exists, in the [threat model](./threat-model.md#cryptographic-inventory). | — |

### Fixed in 0.11.0

| Requirement | Fix | Test |
|---|---|---|
| V10.4.1 | Redirect URIs and post-logout redirect URIs are matched exactly (RFC 9700), except the port of a loopback IP URI (RFC 8252). Fragments are refused. A `/*` wildcard needs the per-client, insecure `allowInsecureWildcardRedirectUris`, which the upgrade sets only on clients that already had one, and which `/admin/upgrade/health` reports. | `redirect-uri.utils.spec.ts`, `redirect-uri.property.spec.ts`, `test/redirect-uri-exact.e2e-spec.ts` |
| V7.3.2, V10.4.8 | An offline session lives for `offlineTokenLifespan`; it was deleted, with its offline tokens, after `refreshTokenLifespan`. The session's absolute expiry is checked at every refresh and introspection, and a refresh token never outlives its session. | `session-lifetime.spec.ts`, `sessions-cleanup.service.spec.ts`, `test/offline-sessions.e2e-spec.ts` |

### Remaining gaps

These are left open on purpose. Most would change behaviour that existing deployments rely on, or need a design of their own, and half a fix would be worse than a documented gap. A few are small but touch admin-only input (theme uploads, custom CSS) and were left for a focused change. In rough priority order:

1. **No MFA on admin console sign-in** (V6.3.3). The console accepts a password only, even when the admin has TOTP enrolled. Needs an MFA step in `AdminAuthService.login` and the console.
2. **Recovery codes** (V6.5.2) have 32 bits of entropy and an unsalted SHA-256. They need at least 112 bits (or a password hash), with a re-issue path for existing codes.
3. **No common, breached or context-word password checks** (V6.2.4, V6.2.11, V6.2.12).
4. **Geo-IP lookups send end-user IPs over plain HTTP to ip-api.com** (V12.3.1, V14.2.3) when adaptive authentication or continuous verification is on. Needs an HTTPS provider or a local database, and an explicit opt-in.
5. **Session idle timeout** (V7.3.1). There is no idle timeout for SSO sessions, nor for offline sessions, which live for `offlineTokenLifespan` from sign-in. (The absolute expiry and the offline lifetime were fixed in 0.11.0.)
6. **RP-initiated logout without `id_token_hint`** ends the session with no confirmation (V10.6.2).
7. **WebSocket upgrade has no Origin check** (V4.4.2).
8. **Theme asset uploads trust the declared MIME type** (V5.2.2) and store SVG unsanitized (V1.3.4).
9. **RSA 2048 signing keys** (V11.2.3). New keys should be 3072-bit; that changes JWKS consumers' expectations only slightly but needs a rotation story.
10. **Users cannot list or end their own sessions, or revoke consents** (V7.5.2, V10.7.3).
11. **Documentation-only gaps:** input validation rules (V2.1.x), file handling (V5.1.1), data classification (V14.1.x), log inventory (V16.1.1), SBOM (V15.1.2).

Every row below has its own recommendation.

## Requirements

### V1 Encoding and Sanitization

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V1.1.1 | 2 | Pass | src/saml/saml-idp.service.ts (decodeSamlRequest: one base64 decode, then inflate) | Input is decoded once, before validation. |
| V1.1.2 | 2 | Pass | Handlebars auto-escaping (src/theme/theme-handlebars.ts); src/brute-force/brute-force.service.ts sendLockoutNotification uses escapeHtml | Output is encoded at render time. The one hand-built email body is now escaped. |
| V1.2.1 | 1 | Pass | src/common/utils/html-escape.util.ts; src/brute-force/brute-force.service.ts (escapeHtml on username and realm name); src/brute-force/brute-force.service.spec.ts | FIXED in this PR: the lockout email interpolated the raw username (SCIM/LDAP/IdP usernames have no character rules). |
| V1.2.2 | 1 | Partial | src/common/redirect-uri.utils.ts:7; src/clients/dto/create-client.dto.ts (redirectUris @IsString only); themes href="\{\{termsOfServiceUrl\}\}" | Admin-entered URLs have no scheme allowlist, so javascript: is accepted. Only admins can set them. **Recommendation:** Accept only http(s) for redirectUris, branding and terms URLs (S). |
| V1.2.3 | 1 | Partial | themes/idenplane/login/templates/login.hbs:73-82; themes/idenplane/account/templates/account.hbs:186 | Request values reach JS string literals with HTML escaping only; a backslash is not escaped. **Recommendation:** Add a JSON-safe Handlebars helper, or move the values to data- attributes (S). |
| V1.2.4 | 1 | Pass | Prisma throughout; $executeRawUnsafe only with constant lock keys (src/admin-auth/admin-seed.service.ts:89, src/secrets-at-rest/secrets-at-rest.service.ts:333) | No user input reaches raw SQL. |
| V1.2.5 | 1 | Pass | src/upgrade/database-backup.service.ts:85,156 (execFileSync with an argument array, no shell) |  |
| V1.2.6 | 2 | Pass | src/user-federation/ldap.client.ts:163,190 (escapeLdap) | The base filter is admin configuration. |
| V1.2.7 | 2 | Pass | src/saml/saml-idp.service.ts (XPath reference id is generated internally) |  |
| V1.2.8 | 2 | N/A |  | No LaTeX processing. |
| V1.2.9 | 2 | Pass | No user input reaches new RegExp; src/scim/filter-parser.redos.spec.ts | src/authorization/policy-engine.ts:270 compiles admin-written patterns without a ReDoS guard (admin input). **Recommendation:** Bound or pre-validate admin policy patterns (S). |
| V1.3.1 | 1 | N/A |  | No WYSIWYG or user HTML input. |
| V1.3.2 | 1 | Pass | No eval, new Function or vm in src/ or admin-ui/src |  |
| V1.3.3 | 2 | Partial | src/main.ts ValidationPipe whitelist+forbidNonWhitelisted; src/scim/scim.controller.ts:158 (@Body() typed as an interface) | Interface-typed and scalar bodies skip class-validator. **Recommendation:** DTO classes for SCIM bodies and the test-email body (M). |
| V1.3.4 | 2 | Partial | src/theme/theme-upload.service.ts:36 accepts image/svg+xml; src/main.ts serves uploads with a sandbox CSP and nosniff | Served SVG is inert, but it is stored unsanitized. **Recommendation:** Sanitize SVG on upload or refuse it (S/M). |
| V1.3.5 | 2 | Partial | src/theme/theme-render.service.ts:24 sanitizeCss (blocklist) | Admin-supplied custom CSS is filtered by blocklist; the CSP limits exfiltration. **Recommendation:** Allowlist CSS parser (M). |
| V1.3.6 | 2 | Partial | src/common/security/safe-http-client.ts (DNS pinning + IP blocklist) for webhooks and SMS webhook; raw fetch in src/tokens/backchannel-logout.service.ts, src/events/audit-streams.service.ts, src/broker/broker.service.ts | Admin- or client-configured URLs on the raw-fetch paths can reach internal addresses. **Recommendation:** Route those fetches through safe-http-client (M). |
| V1.3.7 | 2 | Pass | src/theme/theme-handlebars.ts:4 (isolated env); src/theme/theme-render.service.ts:56 (withoutReservedLocals) | Templates load only from theme files. |
| V1.3.8 | 2 | N/A |  | No JNDI (Node.js). |
| V1.3.9 | 2 | N/A |  | No memcache. |
| V1.3.10 | 2 | N/A |  | No user-controlled format strings. |
| V1.3.11 | 2 | Pass | src/email/providers/smtp.provider.ts:34 (nodemailer with separate fields) |  |
| V1.4.1 | 2 | N/A |  | Memory-safe runtime. |
| V1.4.2 | 2 | N/A |  | Managed runtime; numbers are DTO-validated. |
| V1.4.3 | 2 | N/A |  | Garbage-collected runtime. |
| V1.5.1 | 1 | Pass | src/saml/saml-request-verifier.ts (parseStrictXml: no DTD, entities, comments, processing instructions or duplicate IDs; every xmldom warning is fatal); src/saml/saml-request-hardening.spec.ts | FIXED in 0.11.0: the AuthnRequest signature check now requires one signature on the root, referencing the root, and reads every field from the signed bytes (signature wrapping). |
| V1.5.2 | 2 | Pass | JSON.parse only; src/theme/theme-render.service.ts:47 strips \_\_proto\_\_ |  |

### V2 Validation and Business Logic

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V2.1.1 | 1 | Partial | src/main.ts ValidationPipe; DTO decorators in src/\*\*/dto | Rules exist only as decorators; there is no validation-rules document. **Recommendation:** Document the input rules (S). |
| V2.1.2 | 2 | **Fail** | — | No document on how combined fields must agree. **Recommendation:** Document cross-field rules: redirect\_uri/client, OTP/flow binding, realm scoping (S). |
| V2.1.3 | 2 | Partial | docs/docs/security/secure-defaults.md; docs/docs/configuration/options.md (brute-force section) | Brute-force limits are now documented correctly; global and per-user limits elsewhere are not. **Recommendation:** Document the remaining business limits (S). |
| V2.2.1 | 1 | Partial | src/main.ts ValidationPipe; Record&lt;string,string&gt; bodies in src/account/account.controller.ts:273, src/device/device.controller.ts:183 | Untyped form bodies get no validation. **Recommendation:** DTO classes for account and device forms (M). |
| V2.2.2 | 1 | Pass | src/main.ts ValidationPipe; src/password-policy/password-policy.service.ts:18 | Validation is server-side. |
| V2.2.3 | 2 | Partial | src/sms/sms-otp.service.ts:54 (HMAC binding); src/broker/broker.service.ts:244 | Done for auth artifacts, not as a general rule. **Recommendation:** See V2.1.2 (M). |
| V2.3.1 | 1 | Pass | src/mfa/mfa.service.ts:565-631; src/login/primary-auth-gates.service.ts | Flow steps are tied to one-time pending-action tokens. |
| V2.3.2 | 2 | Partial | src/sms/sms-otp.service.ts:14-22; src/auth-flow/email-otp.service.ts:13-26 | Limits exist in code; per-realm rate limits are opt-in (rateLimitEnabled). **Recommendation:** See the recommended defaults in secure-defaults.md. |
| V2.3.3 | 2 | Partial | src/registration/registration.service.ts:130-175; src/login/login.controller.ts (reset) | Registration and password reset write several rows outside one transaction. **Recommendation:** Wrap in prisma.$transaction (S). |
| V2.3.4 | 2 | N/A |  | No limited-quantity resources. |
| V2.4.1 | 2 | Partial | src/app.module.ts:97 (global throttler); src/rate-limit/rate-limit.service.ts:52 (realm limits off by default); brute-force on by default (src/realms/realm-security-defaults.ts) | Lockout is now on by default; per-realm rate limits remain opt-in. **Recommendation:** Enable per-realm rate limits by default after NAT-safe limits are chosen. |

### V3 Web Frontend Security

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V3.2.1 | 1 | Pass | src/main.ts helmet (nosniff, CSP); uploads served with sandbox CSP |  |
| V3.2.2 | 1 | Pass | admin-ui React, no dangerouslySetInnerHTML; preview iframe sandbox="allow-scripts" without allow-same-origin |  |
| V3.3.1 | 1 | Partial | src/login/session-issuer.service.ts:84 (secure:true); src/admin-auth/admin-auth.controller.ts:101,131 (secure only in production) | No \_\_Secure-/\_\_Host- prefixes. **Recommendation:** Secure always; \_\_Secure- prefix with a legacy alias (M). |
| V3.3.2 | 2 | Pass | src/login/session-issuer.service.ts:89 (SSO Lax); CSRF and admin cookies Strict |  |
| V3.3.3 | 2 | **Fail** | Cookie names IDENPLANE\_SESSION, XSRF-TOKEN-\{realm\}, admin\_rt with Path=/realms/\{realm\} | Path scoping rules out \_\_Host-. **Recommendation:** \_\_Host-IDENPLANE\_SESSION-\{realm\} with Path=/ (M). |
| V3.3.4 | 2 | Partial | src/admin-auth/admin-auth.controller.ts:99,107,170 | admin\_rt is HttpOnly but holds the same token returned in the JSON body. **Recommendation:** A refresh-only token in the cookie (M). |
| V3.4.1 | 1 | Pass | src/main.ts:251-254 (HSTS max-age 1y, includeSubDomains, preload) |  |
| V3.4.2 | 1 | Pass | src/main.ts:140-170 (origin allowlist); src/clients/dto/create-client.dto.ts:48 (no wildcard) | `http://localhost:PORT` stays allowed in production. |
| V3.4.3 | 2 | Partial | helmet defaults; src/theme/theme-render.service.ts:132 (nonce CSP, base-uri self) | object-src none; base-uri is self, not none. **Recommendation:** base-uri none for themed pages (S). |
| V3.4.4 | 2 | Pass | helmet nosniff (src/main.ts) |  |
| V3.4.5 | 2 | Pass | helmet Referrer-Policy no-referrer |  |
| V3.4.6 | 2 | Pass | helmet frame-ancestors self; themes none (src/theme/theme-render.service.ts:133) |  |
| V3.5.1 | 1 | Pass | src/common/csrf/csrf.service.ts (double submit); admin API needs Authorization or x-admin-api-key |  |
| V3.5.2 | 1 | Pass | Admin API requires non-safelisted headers |  |
| V3.5.3 | 1 | Partial | src/account/account.controller.ts:210 (GET logout) | A cross-site GET can log a user out of the account console. **Recommendation:** POST with CSRF (S). |
| V3.5.4 | 2 | Partial | src/app.module.ts:116 (admin console served on the same origin as realm pages) | No origin separation between admin and end-user UI. **Recommendation:** Optional separate admin hostname (L). |
| V3.5.5 | 2 | N/A |  | No postMessage listeners. |
| V3.7.1 | 2 | Pass | React SPA, no plugins |  |
| V3.7.2 | 2 | Pass | src/tokens/tokens.service.ts (validatePostLogoutRedirectUri); src/common/redirect-uri.utils.ts | Redirects only to registered URIs, matched exactly since 0.11.0 (see V10.4.1). |

### V4 API and Web Service

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V4.1.1 | 1 | Partial | src/account/account.controller.ts:968 (application/json without charset) |  |
| V4.1.2 | 2 | Pass | src/main.ts:247 (no HTTP-to-HTTPS redirect in the app) |  |
| V4.1.3 | 2 | Pass | src/common/utils/proxy-ip.util.ts:132 (TRUSTED\_PROXIES) | TRUSTED\_PROXIES=\* trusts everyone (operator choice). |
| V4.2.1 | 2 | Pass | Node llhttp rejects ambiguous TE/CL |  |
| V4.3.1 | 2 | N/A | No GraphQL endpoint: the unmounted GraphQL module and its packages were removed after 0.10.0 | Idenplane has no GraphQL API. **Recommendation:** If one is added: depth and cost limits, introspection off. |
| V4.3.2 | 2 | N/A | as V4.3.1 | Idenplane has no GraphQL API. **Recommendation:** Keep introspection off in production if one is added. |
| V4.4.1 | 1 | Partial | src/main.ts (gateway on the plain HTTP server) | WSS relies on the TLS-terminating proxy. **Recommendation:** Refuse upgrades without x-forwarded-proto=https in production (S). |
| V4.4.2 | 2 | **Fail** | src/realtime/session-events.gateway.ts:101-131 | No Origin check on the WebSocket upgrade. **Recommendation:** Check Origin against the CORS allowlist (S). |
| V4.4.3 | 2 | Partial | src/realtime/session-events.gateway.ts:182 (?token= in URL) | Access token in the URL can reach logs (redacted by redact-url). **Recommendation:** Send the token in the first message (M). |
| V4.4.4 | 2 | Pass | src/realtime/session-events.gateway.ts:178-230 (signature, typ Bearer, cert binding, blacklist, session) |  |

### V5 File Handling

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V5.1.1 | 2 | **Fail** | — | Upload types and sizes are not documented. **Recommendation:** Document theme-asset uploads and realm import limits (S). |
| V5.2.1 | 1 | Pass | default 100 kB body parser; src/theme/theme-upload.service.ts:39 (5 MB) | The 5 MB check trusts the declared size. |
| V5.2.2 | 1 | **Fail** | src/theme/theme-upload.service.ts:107,135 | The client-declared MIME type is trusted; no magic-byte check. **Recommendation:** Sniff magic bytes and check the decoded length (S). |
| V5.2.3 | 2 | Pass | src/saml/saml-idp.service.ts decodeSamlRequest (maxOutputLength); src/saml/saml-idp.service.spec.ts "refuses a compressed request that inflates past the size limit" | FIXED in this PR: inflation was unbounded before the size check. |
| V5.3.1 | 1 | Pass | src/main.ts:312 (static serving, sandbox CSP) |  |
| V5.3.2 | 1 | Pass | src/theme/theme-upload.service.ts:118-128 (generated file names) |  |
| V5.4.1 | 2 | Partial | src/account/account.controller.ts:970 (export filename embeds the username) |  **Recommendation:** Generated or sanitized filename (S). |
| V5.4.2 | 2 | Partial | src/account/account.controller.ts:970 | No RFC 6266 encoding. **Recommendation:** Use filename\* (S). |
| V5.4.3 | 2 | **Fail** | — | No malware scan of uploaded assets (image-only types and sandbox CSP reduce the risk). **Recommendation:** Optional scanning hook (M). |

### V6 Authentication

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V6.1.1 | 1 | Pass | docs/docs/security/secure-defaults.md; src/realms/realm-security-defaults.ts | FIXED in this PR: documented lockout settings, defaults and the lockout-DoS trade-off (the old docs used Keycloak field names). |
| V6.1.2 | 2 | **Fail** | src/password-policy/password-policy.service.ts | No list of context-specific words. **Recommendation:** See V6.2.11. |
| V6.1.3 | 2 | Partial | docs/docs/guides/authentication.mdx | Pathways are listed, not their strength; admin login and device approval are missing. **Recommendation:** Pathway matrix (S). |
| V6.2.1 | 1 | Partial | prisma/schema.prisma (passwordMinLength default 8); src/realms/dto/create-realm.dto.ts (@Min(1)) | Default is 8, but an admin can set a lower minimum. **Recommendation:** Floor at 8 (S; would reject saving realms already configured lower). |
| V6.2.2 | 1 | Pass | src/account/account.controller.ts:268; src/login/login.controller.ts:789 |  |
| V6.2.3 | 1 | Pass | src/account/account.controller.ts:283-321 | Current password required. |
| V6.2.4 | 1 | **Fail** | src/password-policy/password-policy.service.ts:18-44 | No common-password check. **Recommendation:** Bundle a top-3000/10k list (S). |
| V6.2.5 | 1 | Partial | src/password-policy/password-policy.service.ts:27-41 | Composition rules are off by default but available. **Recommendation:** Deprecate composition rules (S). |
| V6.2.6 | 1 | Pass | themes/\*/login/templates (type=password) |  |
| V6.2.7 | 1 | Pass | themes (no onpaste blocking, no autocomplete=off on passwords) |  |
| V6.2.8 | 1 | Pass | src/crypto/crypto.service.ts:164-189 | Verified as received. |
| V6.2.9 | 2 | Pass | src/crypto/crypto.service.ts:38 (MAX\_PASSWORD\_LENGTH 1024) |  |
| V6.2.10 | 2 | Partial | src/password-policy/password-policy.service.ts:98-104 (passwordMaxAgeDays, default 0) | Periodic rotation is optional and off by default. **Recommendation:** Warn against it in the console (S). |
| V6.2.11 | 2 | **Fail** | src/password-policy/password-policy.service.ts:18 | No context-word check (username, realm, email). **Recommendation:** Reject passwords containing them (S). |
| V6.2.12 | 2 | **Fail** | src/password-policy/password-policy.service.ts:18 | No breached-password check. **Recommendation:** Optional k-anonymity breach check per realm (M). |
| V6.3.1 | 1 | Pass | src/realms/realm-security-defaults.ts; src/brute-force/brute-force.service.ts; test/secure-realm-defaults.e2e-spec.ts; test/brute-force.e2e-spec.ts | FIXED in this PR: lockout is on for new realms; realms created before 0.10.0 keep their setting and are reported by /admin/upgrade/health. |
| V6.3.2 | 1 | Pass | src/admin-auth/admin-seed.service.ts:14-30 (random initial password; weak ones refused in production) |  |
| V6.3.3 | 2 | **Fail** | src/admin-auth/admin-auth.service.ts (password only); prisma/schema.prisma mfaRequired default false | Admin console sign-in has no second factor. **Recommendation:** MFA challenge on admin login (M). |
| V6.3.4 | 2 | Partial | src/device/device.controller.ts; src/auth/auth.service.ts (device and code grants refuse disabled users); src/admin-auth/admin-auth.service.ts | FIXED in part: disabled users can no longer finish the device flow or exchange a code. Admin login still lacks MFA. **Recommendation:** See V6.3.3. |
| V6.4.1 | 1 | Partial | src/users/dto/set-password.dto.ts:15 (temporary ignored) | Initial passwords never expire or force a change. **Recommendation:** mustChangePassword flag (M). |
| V6.4.2 | 1 | Pass | No secret questions or hints |  |
| V6.4.3 | 2 | Pass | src/login/login.controller.ts (reset sets the password, then normal login with MFA) |  |
| V6.4.4 | 2 | Partial | src/mfa/mfa.service.ts:356-368 (admin factor reset) | No documented identity-proofing step. **Recommendation:** Document it and record an admin event (M). |
| V6.5.1 | 2 | Pass | src/mfa/mfa.service.ts:265-300; src/magic-link/magic-link.service.ts:472; src/sms/sms-otp.service.ts:631; test/totp-replay.e2e-spec.ts | Single use. |
| V6.5.2 | 2 | **Fail** | src/mfa/mfa.service.ts:325-331 | Recovery codes have 32 bits of entropy and are stored as unsalted SHA-256. **Recommendation:** At least 112-bit codes, or argon2 (S/M). |
| V6.5.3 | 2 | Pass | crypto.randomInt / randomBytes in src/sms/sms-otp.service.ts:179, src/auth-flow/email-otp.service.ts:191 |  |
| V6.5.4 | 2 | Pass | src/mfa/mfa.service.ts:325; src/sms/sms-otp.service.ts:48 | At least 20 bits. |
| V6.5.5 | 2 | Partial | src/sms/sms-otp.service.ts:51 (max 900 s); src/realms/dto/create-realm.dto.ts (magicLinkExpirySeconds no @Max) | Out-of-band lifetime can exceed 10 minutes. **Recommendation:** Cap at 600 s (S). |
| V6.6.1 | 2 | Partial | src/sms/sms-otp.service.ts:196-226 | No SMS risk notice to users. **Recommendation:** Add a notice to the SMS setup page (S). |
| V6.6.2 | 2 | Pass | src/sms/sms-otp.service.ts:25-54; src/auth-flow/email-otp.service.ts:66 |  |
| V6.6.3 | 2 | Pass | src/sms/sms-otp.service.ts:14-20,631; src/auth-flow/email-otp.service.ts:13-26 |  |
| V6.8.1 | 2 | Pass | prisma/schema.prisma (FederatedIdentity unique per IdP); src/broker/broker.service.ts:555-583 |  |
| V6.8.2 | 2 | Partial | src/broker/broker.service.ts:386-420 | Upstream id\_token is not verified; identity comes from userinfo over TLS with the IdP access token. **Recommendation:** Verify the id\_token via the IdP JWKS (M). |
| V6.8.3 | 2 | N/A | src/saml (IdP only) | Idenplane never consumes SAML assertions. The AuthnRequests it receives are accepted once per ID within their validity window since 0.11.0 (src/saml/saml-idp.service.ts claimRequestId; test/saml-request-replay.e2e-spec.ts). |
| V6.8.4 | 2 | Partial | src/broker/broker.service.ts:375 | Upstream acr/amr are ignored. **Recommendation:** Map upstream amr; document the fallback (M). |

### V7 Session Management

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V7.1.1 | 2 | Partial | docs/docs/security/secure-defaults.md (session lifetimes); docs/docs/configuration/options.md; prisma/schema.prisma (accessTokenLifespan, refreshTokenLifespan, offlineTokenLifespan) | FIXED in part: the real settings are documented, including the offline session lifetime (0.11.0); there is no idle timeout to document (V7.3.1). |
| V7.1.2 | 2 | Pass | docs/docs/guides/authentication.mdx; src/login/login.service.ts:157-182 | maxSessionsPerUser documented and enforced. |
| V7.1.3 | 2 | Partial | docs/docs/api/oauth.md (backchannel logout) |  |
| V7.2.1 | 1 | Pass | src/login/login.service.ts:187-215 | Session token looked up by hash server-side. |
| V7.2.2 | 1 | Partial | src/common/guards/admin-api-key.guard.ts:150-200 | The static ADMIN\_API\_KEY gives super-admin access. **Recommendation:** Make the API key bootstrap-only in production (M). |
| V7.2.3 | 1 | Pass | src/crypto/crypto.service.ts:191; src/login/login.service.ts:140 | 256-bit session tokens, stored hashed. |
| V7.2.4 | 1 | Partial | src/login/login.service.ts:129-138; src/step-up/step-up.service.ts:165 | New token at login; step-up keeps the same token. **Recommendation:** Rotate after step-up (S). |
| V7.3.1 | 2 | Partial | prisma/schema.prisma (LoginSession has no last-activity field) | Refresh tokens slide; SSO and admin sessions have no idle timeout. **Recommendation:** lastSeenAt plus an idle-timeout setting (M). |
| V7.3.2 | 2 | Pass | src/sessions/session-lifetime.ts; src/auth/auth.service.ts (handleRefreshTokenGrant); src/tokens/tokens.service.ts (introspectRefreshToken); src/login/login.service.ts (SSO expiresAt); src/admin-auth/admin-auth.controller.ts (admin token: 1 h, refresh returns the same token); test/offline-sessions.e2e-spec.ts | FIXED in 0.11.0: the absolute session expiry is checked at refresh and introspection, not left to the hourly clean-up, and offline sessions get their own expiry (offlineTokenLifespan) instead of being deleted after refreshTokenLifespan. |
| V7.4.1 | 1 | Pass | src/tokens/tokens.service.ts:427-475 | Logout deletes sessions; later sid checks fail. |
| V7.4.2 | 1 | Pass | src/users/users.service.ts; src/auth/auth.service.ts (code and device grants check enabled); src/tokens/tokens.service.ts:525 | FIXED gap: the code exchange did not check enabled. |
| V7.4.3 | 2 | Partial | src/login/login.controller.ts endAllSessions; test/theme-views.e2e-spec.ts (reset ends sessions) | FIXED in part: a password reset ends every session. Self-service change and admin set do not offer the option. **Recommendation:** Add "sign out other sessions" to password change (S). |
| V7.4.4 | 2 | Pass | themes/idenplane/account/templates/account.hbs:11; admin-ui Layout.tsx |  |
| V7.4.5 | 2 | Partial | src/sessions/sessions.controller.ts:58-83 | No realm-wide termination; admin termination sends no back-channel logout. **Recommendation:** (S) |
| V7.5.1 | 2 | Partial | src/account/account.controller.ts:283-322,688-702; src/webauthn/webauthn.controller.ts:78-118,341-354 | TOTP enrolment and passkey add/delete need only the session. **Recommendation:** Require re-authentication (S). |
| V7.5.2 | 2 | **Fail** | src/account/account.controller.ts | Users cannot list or end their own sessions. **Recommendation:** Account session list (M). |
| V7.6.1 | 2 | Partial | src/tokens/backchannel-logout.service.ts; src/oauth/oauth.controller.ts:208-231 | Admin and account-console terminations do not notify RPs. **Recommendation:** (S) |
| V7.6.2 | 2 | Pass | src/oauth/oauth.controller.ts:174-231; src/login/session-issuer.service.ts:50-97 |  |

### V8 Authorization

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V8.1.1 | 1 | Pass | docs/docs/getting-started/admin-roles.mdx |  |
| V8.1.2 | 2 | Partial | docs/docs/getting-started/admin-roles.mdx:105 | No field-level rules documented. **Recommendation:** (S) |
| V8.2.1 | 1 | Pass | src/common/guards/admin-authorization.guard.ts:72-138; src/admin-rbac/admin-route-policy.ts; admin-route-policy.fitness.spec.ts | Fails closed. |
| V8.2.2 | 1 | Pass | src/users/users.service.ts:226; src/sessions/sessions.service.ts; test/admin-rbac.e2e-spec.ts | Realm-scoped lookups. |
| V8.2.3 | 2 | Partial | src/main.ts ValidationPipe; src/users/users.service.ts:22-33 | Not role-aware for reads. **Recommendation:** (M) |
| V8.3.1 | 1 | Pass | src/common/guards/admin-authorization.guard.ts:113-136; src/admin-rbac/admin-principal.service.ts:57-70 | Roles read from the DB per request. |
| V8.4.1 | 2 | Pass | src/admin-rbac/admin-access-policy.ts:91-153 | Tenants (realms) isolated; master never in a realm-admin scope. |

### V9 Self-contained Tokens

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V9.1.1 | 1 | Pass | src/crypto/jwk.service.ts:94-99 |  |
| V9.1.2 | 1 | Pass | src/crypto/jwk.service.ts:56-61 (key imported for RS256 only) | No explicit algorithm allowlist; the key type pins it. **Recommendation:** Pass algorithms:\[RS256] (S). |
| V9.1.3 | 1 | Pass | src/crypto/jwk.service.ts:94-99 | jku/x5u/jwk headers ignored. |
| V9.2.1 | 1 | Pass | src/crypto/jwk.service.ts:97 (jose checks exp/nbf) |  |
| V9.2.2 | 2 | Pass | src/tokens/access-token-type.ts; src/tokens/tokens.service.ts (userinfo, introspect); src/realtime/session-events.gateway.ts; tokens.service.spec.ts "refuses an ID token" | FIXED in this PR: ID, logout and admin tokens signed with the realm key were accepted as access tokens. |
| V9.2.3 | 2 | Partial | src/crypto/jwk.service.ts:94-99 | No issuer or audience check at verification. **Recommendation:** Pass issuer/audience to verifyJwt; aud on admin tokens (S/M). |
| V9.2.4 | 2 | Pass | src/auth/auth.service.ts (aud=clientId); src/tokens/backchannel-logout.service.ts |  |

### V10 OAuth and OIDC

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V10.1.1 | 2 | Partial | admin-ui/src/context/AuthContext.tsx:5 | Admin access token lives in browser memory (refresh in an HttpOnly cookie). **Recommendation:** BFF for the console (L). |
| V10.1.2 | 2 | Partial | src/broker/broker.service.ts:147-169,226-247 | Legacy broker state is not bound to the browser; no PKCE upstream. **Recommendation:** Bind state to a cookie; PKCE S256 upstream (M). |
| V10.2.1 | 2 | Partial | src/broker/broker.service.ts:183-188 | Login CSRF possible on the legacy broker callback. **Recommendation:** As V10.1.2. |
| V10.2.2 | 2 | Pass | src/broker/broker.service.ts:181,243 | Per-IdP callback URL. |
| V10.3.1 | 2 | Partial | src/tokens/access-token-type.ts; src/tokens/tokens.service.ts | FIXED in part: token type now checked; audience is not. **Recommendation:** See V9.2.3. |
| V10.3.2 | 2 | Pass | src/tokens/tokens.service.ts:518-533 |  |
| V10.3.3 | 2 | Pass | src/tokens/tokens.service.ts:518 | sub is a per-realm UUID. |
| V10.3.4 | 2 | N/A |  | No resource endpoint requires a particular acr. |
| V10.4.1 | 1 | Pass | src/common/redirect-uri.utils.ts (matchesRedirectUri); src/common/redirect-uri.utils.spec.ts; src/common/redirect-uri.property.spec.ts; test/redirect-uri-exact.e2e-spec.ts | FIXED in 0.11.0: exact string comparison, loopback port excepted (RFC 8252); fragments refused; wildcards refused at registration. Clients that had `/*` entries before the upgrade keep them through the per-client `allowInsecureWildcardRedirectUris` opt-in, reported by `/admin/upgrade/health` (`wildcard_redirect_uris`) until an admin turns it off. |
| V10.4.2 | 1 | Pass | src/auth/auth.service.ts (atomic single use, replay revokes the session); test/oidc-conformance.e2e-spec.ts |  |
| V10.4.3 | 1 | Pass | src/oauth/oauth.service.ts:133 (60 s) |  |
| V10.4.4 | 1 | Partial | src/clients/dto/create-client.dto.ts:157-160 | No implicit flow; the password grant can still be enabled per client. **Recommendation:** Allowlist grantTypes; gate password (S). |
| V10.4.5 | 1 | Pass | src/auth/auth.service.ts:820-940; test/refresh-rotation.e2e-spec.ts | Rotation with reuse detection. |
| V10.4.6 | 2 | Partial | src/oauth/oauth.service.ts:71-86 | S256 only; required for public clients only. **Recommendation:** Realm flag to require PKCE for every client (S). |
| V10.4.7 | 2 | N/A |  | No dynamic client registration. |
| V10.4.8 | 2 | Pass | src/sessions/session-lifetime.ts (refreshTokenExpiresAt); src/auth/auth.service.ts (handleRefreshTokenGrant checks session.expiresAt); test/offline-sessions.e2e-spec.ts | FIXED in 0.11.0: a rotated refresh token never outlives its session, and the session's absolute expiry (refreshTokenLifespan, or offlineTokenLifespan for an offline session) is checked at every refresh. |
| V10.4.9 | 2 | Pass | src/users/users.controller.ts:240; src/sessions/sessions.controller.ts |  |
| V10.4.10 | 2 | Pass | src/client-auth/client-authenticator.ts:425 |  |
| V10.4.11 | 2 | Partial | src/scopes/scopes.service.ts:53-80 | A client with no scopes assigned can request any supported scope. **Recommendation:** Grant assigned scopes only (S). |
| V10.5.1 | 2 | N/A | src/broker/broker.service.ts:382-414 | The broker does not consume the id\_token. |
| V10.5.2 | 2 | Pass | src/broker/broker.service.ts:299-305 |  |
| V10.5.3 | 2 | N/A | src/broker/providers.ts | No metadata discovery. |
| V10.5.4 | 2 | N/A |  | id\_token not consumed. |
| V10.5.5 | 2 | Partial | src/tokens/tokens.service.ts:541-585 | Logout token checks: no typ, nonce or aud check. **Recommendation:** (S) |
| V10.6.1 | 2 | Pass | src/oauth/oauth.service.ts:43 | response\_type=code only. |
| V10.6.2 | 2 | **Fail** | src/tokens/tokens.controller.ts:244-295 | GET logout without id\_token\_hint ends the session with no confirmation. **Recommendation:** Confirmation page (S/M). |
| V10.7.1 | 2 | Partial | src/login/post-auth.service.ts:104 | Consent only when requireConsent or prompt=consent. **Recommendation:** Default requireConsent for third-party clients (S). |
| V10.7.2 | 2 | Partial | src/login/login.controller.ts:979-995 | No lifetime or offline-access notice. **Recommendation:** (S) |
| V10.7.3 | 2 | Partial | src/users/users.controller.ts:254-298 | Only admins can revoke consents. **Recommendation:** Account consent page (M). |

### V11 Cryptography

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V11.1.1 | 2 | Partial | docs/docs/security/threat-model.md (key assets); src/crypto/key-ring.ts | No formal key-management policy. **Recommendation:** Write one (S). |
| V11.1.2 | 2 | Pass | docs/docs/security/threat-model.md "Cryptographic inventory" | FIXED in this PR: inventory written. |
| V11.2.1 | 2 | Pass | node:crypto, jose, argon2, @peculiar/x509 |  |
| V11.2.2 | 2 | Partial | src/crypto/key-ring.ts:11-24,91-94; src/crypto/jwk.service.ts | AES key ring rotates; signing algorithm is fixed to RS256. **Recommendation:** (M) |
| V11.2.3 | 2 | **Fail** | src/crypto/jwk.service.ts:64 (RSA 2048) | 2048-bit RSA is about 112-bit security. **Recommendation:** 3072-bit for new keys (S). |
| V11.3.1 | 1 | Pass | src/crypto/key-ring.ts:29 |  |
| V11.3.2 | 1 | Pass | src/crypto/key-ring.ts:29-30 (AES-256-GCM) |  |
| V11.3.3 | 2 | Pass | src/crypto/key-ring.ts:21-22,129-135 |  |
| V11.4.1 | 1 | Pass | src/crypto/crypto.service.ts:108,141 | HMAC-SHA1 only for TOTP compatibility. |
| V11.4.2 | 2 | Pass | src/crypto/crypto.service.ts:171-175 (argon2id m=64 MiB t=3 p=4) |  |
| V11.4.3 | 2 | Pass | SHA-256 throughout |  |
| V11.4.4 | 2 | Partial | src/crypto/key-ring.ts:40,68-70 | scrypt N=2^14 with a static default salt. **Recommendation:** Require a 32-byte random key (S). |
| V11.5.1 | 2 | Pass | src/oauth/oauth.service.ts:115; src/crypto/crypto.service.ts:42 | Math.random only in non-security code (retry jitter). |
| V11.6.1 | 2 | Pass | src/crypto/jwk.service.ts:64; src/nhi/certificate.ts:74-90 |  |

### V12 Secure Communication

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V12.1.1 | 1 | N/A | src/main.ts (plain HTTP); src/mtls/mtls-config.ts:15 (TLS 1.2+ on the mTLS listener) | TLS terminates at the operator's proxy. |
| V12.1.2 | 2 | N/A | src/mtls/mtls-server.ts:140 | Proxy concern; mTLS listener uses Node defaults. |
| V12.1.3 | 2 | Pass | src/mtls/mtls-server.ts:92,142; src/main.ts checkMtlsConfig | Cert validated per realm per request. |
| V12.2.1 | 1 | Partial | src/main.ts helmet HSTS; secure cookies | HTTPS redirect is left to the proxy. **Recommendation:** Document it (S). |
| V12.2.2 | 1 | N/A |  | Certificates live at the proxy. |
| V12.3.1 | 2 | **Fail** | src/risk-assessment/impossible-travel.service.ts:43,85; src/continuous-verification/network-context.service.ts:331 (`http://ip-api.com`) | End-user IPs sent over plain HTTP to a third party; SMTP STARTTLS not required. **Recommendation:** Opt-in geo-IP over HTTPS or a local DB; requireTLS for SMTP (S/M). |
| V12.3.2 | 2 | Pass | src/user-federation/ldap.client.ts:49,69 (rejectUnauthorized true) |  |
| V12.3.3 | 2 | Partial | docker-compose.production.yml:64,75 | Internal DB/Redis links plaintext by default. **Recommendation:** Document sslmode=require and rediss (S). |
| V12.3.4 | 2 | Partial | — | No option to trust only an internal CA for DB/Redis/SMTP. **Recommendation:** (M) |

### V13 Configuration

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V13.1.1 | 2 | Partial | docs/docs/security/threat-model.md (trust boundaries) | Outbound connections now listed in the threat model; no operator inventory page. **Recommendation:** (S) |
| V13.2.1 | 2 | Partial | DATABASE\_URL/REDIS\_URL/ADMIN\_API\_KEY | Static backend credentials. **Recommendation:** (M) |
| V13.2.2 | 2 | Partial | docker-entrypoint.sh (migrate deploy as the runtime user) | One DB role for migration and runtime. **Recommendation:** Split roles (M). |
| V13.2.3 | 2 | Partial | src/main.ts:30-36; src/crypto/crypto.service.ts:128-160 | Placeholders refused in production; prod compose Redis has no password. **Recommendation:** requirepass in compose (S). |
| V13.2.4 | 2 | Partial | src/common/security/safe-http-client.ts | Blocklist, not allowlist; some fetches bypass it (V1.3.6). **Recommendation:** (M) |
| V13.2.5 | 2 | Partial | helm/ | No egress NetworkPolicy. **Recommendation:** (M) |
| V13.3.1 | 2 | Partial | src/crypto/stored-secrets.ts; src/secrets-at-rest/ | Secrets encrypted at rest; key from env, no KMS. **Recommendation:** (L) |
| V13.3.2 | 2 | Partial | helm values (non-root, automount configurable) |  |
| V13.4.1 | 1 | Pass | .dockerignore (.git excluded) |  |
| V13.4.2 | 2 | Pass | src/common/logger/logger.config.ts; src/common/filters/http-exception.filter.ts | No GraphQL endpoint. |
| V13.4.3 | 2 | Pass | src/main.ts:310 (index:false) |  |
| V13.4.4 | 2 | Pass | No TRACE routes |  |
| V13.4.5 | 2 | Partial | src/health/prisma-health.indicator.ts (generic message); src/main.ts:355 (Swagger at /api) | FIXED in part: /health/ready no longer leaks the DB error. Swagger UI stays public by design (documented API). **Recommendation:** SWAGGER\_ENABLED switch for operators who want it off (S). |

### V14 Data Protection

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V14.1.1 | 2 | Partial | docs/docs/security/threat-model.md (assets and their sensitivity) | Assets classified in the threat model; no formal data-classification policy. **Recommendation:** (M) |
| V14.1.2 | 2 | **Fail** | — | No per-level protection requirements. **Recommendation:** (M) |
| V14.2.1 | 1 | Partial | src/common/logger/redact-url.ts | Codes and magic-link tokens travel in URLs by protocol design; redacted in logs. |
| V14.2.2 | 2 | Partial | src/auth/auth.controller.ts:68 (no-store on /token) | Other sensitive responses have no no-store. **Recommendation:** Global no-store for API responses (S). |
| V14.2.3 | 2 | **Fail** | src/risk-assessment/impossible-travel.service.ts:43 | End-user IPs sent to ip-api.com. **Recommendation:** As V12.3.1. |
| V14.2.4 | 2 | Partial | src/events/admin-event-redaction.ts; src/events/events-cleanup.service.ts |  |
| V14.3.1 | 1 | Partial | admin-ui AuthContext (memory only) | No Clear-Site-Data on logout. **Recommendation:** (S) |
| V14.3.2 | 2 | Partial | see V14.2.2 |  |
| V14.3.3 | 2 | Pass | admin-ui/src/api/client.ts:5 | No tokens in Web Storage. |

### V15 Secure Coding and Architecture

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V15.1.1 | 1 | Partial | SECURITY.md (90-day fix target) | No SLA for third-party updates. **Recommendation:** (S) |
| V15.1.2 | 2 | **Fail** | .github/workflows/docker-publish.yml | No SBOM produced. **Recommendation:** npm sbom / sbom:true (S). |
| V15.1.3 | 2 | **Fail** | — | Resource-heavy functionality not documented. **Recommendation:** (S) |
| V15.2.1 | 1 | Partial | .github/dependabot.yml | No server npm audit gate in CI. **Recommendation:** (S) |
| V15.2.2 | 2 | Pass | src/app.module.ts:97; src/crypto/crypto.service.ts:82 (ARGON2\_MAX\_CONCURRENCY) |  |
| V15.2.3 | 2 | Pass | Dockerfile (npm ci --omit=dev, prune) |  |
| V15.3.1 | 1 | Pass | src/users/users.service.ts:22 (USER\_SELECT) |  |
| V15.3.2 | 2 | Partial | src/tokens/backchannel-logout.service.ts, src/events/audit-streams.service.ts (redirect:error); src/broker/broker.service.ts, src/captcha/captcha.service.ts (follow) | FIXED in part: back-channel logout and audit streams no longer follow redirects. **Recommendation:** Same for broker and CAPTCHA calls (S). |
| V15.3.3 | 2 | Pass | src/main.ts ValidationPipe; explicit Prisma data objects |  |
| V15.3.4 | 2 | Pass | src/common/utils/proxy-ip.util.ts |  |
| V15.3.5 | 2 | Partial | src/auth/auth.controller.ts:64; src/account/account.controller.ts:235 | Untyped bodies: repeated keys become arrays (fails closed with 500). **Recommendation:** (M) |
| V15.3.6 | 2 | Pass | src/scim/scim-users.service.ts:489; src/theme/theme-render.service.ts:52 |  |
| V15.3.7 | 2 | Partial | as V15.3.5 |  |

### V16 Security Logging and Error Handling

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V16.1.1 | 2 | **Fail** | — | No log inventory. **Recommendation:** (S) |
| V16.2.1 | 2 | Partial | src/common/logger/logger.config.ts:61 | x-request-id accepted unchecked; app log lines lack the actor. **Recommendation:** (S) |
| V16.2.2 | 2 | Pass | pino epoch ms; timestamptz |  |
| V16.2.3 | 2 | Partial | stdout, audit streams, webhooks |  |
| V16.2.4 | 2 | Pass | pino JSON in production |  |
| V16.2.5 | 2 | Partial | src/email/providers/\*.provider.ts; src/sms/providers/\*.provider.ts | Recipient e-mail addresses and phone numbers logged at info. **Recommendation:** Log user ids or masked recipients (S). |
| V16.3.1 | 2 | Pass | src/realms/realm-security-defaults.ts (eventsEnabled, adminEventsEnabled on); src/events/events.service.ts | FIXED in this PR: new realms record login and admin events; older realms keep their setting. |
| V16.3.2 | 2 | Partial | logger.config.ts:28 (4xx at warn); admin-authorization.guard.ts (denials logged) |  |
| V16.3.3 | 2 | Partial | src/brute-force/brute-force.service.ts (every lockout logged) | FIXED in part: temporary lockouts are now logged; CSRF and validation failures are not. **Recommendation:** (S) |
| V16.3.4 | 2 | Pass | src/common/filters/http-exception.filter.ts:48 |  |
| V16.4.1 | 2 | Pass | pino JSON escaping |  |
| V16.4.2 | 2 | N/A |  | Log storage is the platform's. |
| V16.4.3 | 2 | Partial | src/events/audit-streams.service.ts | Available, opt-in. |
| V16.5.1 | 2 | Pass | src/common/filters/http-exception.filter.ts:57-64; src/health/prisma-health.indicator.ts |  |
| V16.5.2 | 2 | Pass | AbortSignal.timeout on outbound calls |  |
| V16.5.3 | 2 | Pass | src/main.ts (startup exits on bad keys); src/brute-force/brute-force.service.ts (serializable transaction) |  |

### V17 WebRTC

| Req | L | Status | Evidence | Notes and recommendation |
|---|---|---|---|---|
| V17.1.1 | 2 | N/A |  | No WebRTC. |
| V17.2.1 | 2 | N/A |  | No WebRTC. |
| V17.2.2 | 2 | N/A |  | No WebRTC. |
| V17.2.3 | 2 | N/A |  | No WebRTC. |
| V17.2.4 | 2 | N/A |  | No WebRTC. |
| V17.3.1 | 2 | N/A |  | No WebRTC. |
| V17.3.2 | 2 | N/A |  | No WebRTC. |
