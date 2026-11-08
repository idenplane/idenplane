# Changelog

All notable changes to Idenplane are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For full per-commit detail, see the [GitHub Releases](https://github.com/idenplane/idenplane/releases).

## [Unreleased]

### Changed
- **The Docker image is about 620 MB smaller on disk** (447 MB to 317 MB to download). A final `chown -R /app` copied all of `node_modules` into a second layer only to change its owner. The app code and `node_modules` now stay owned by root, so a compromised process cannot rewrite them; the `node` user owns only what the server writes: `/app` itself, `uploads`, `backups` and `themes`.

## [0.5.2] - 2026-11-08

Machine-to-machine authentication gets much faster and stops dropping tokens under load, and clients created by the setup wizard or imported from Authentik or Zitadel can authenticate at all. **If you rely on a `refresh_token` from client_credentials, read Changed below.** The upgrade runs one migration and needs no secret rotation.

### Fixed
- **Clients created by the setup wizard, or imported from Authentik or Zitadel, could not authenticate.** Their secrets were stored as plaintext, which the secret check could not read (500 on every token request) ([#1702](https://github.com/idenplane/idenplane/pull/1702)). A migration hashes those rows; the clients work with the secrets they already have. The wizard also no longer keeps a copy of the secret in its own state.
- A client secret left in the database in no known hash format is now rejected with `invalid_client` instead of a 500.
- **A client_credentials token could turn inactive within seconds under load.** Each token for a client with a service account (every confidential client with `client_credentials` gets one) opened a session, and only the newest 100 were kept, so a client that requested tokens quickly saw its earlier, unexpired tokens fail introspection. These tokens no longer have a session, so nothing pushes them out ([#1704](https://github.com/idenplane/idenplane/pull/1704)).
- Userinfo now rejects a token whose user has been disabled. Introspection already did.
- The docs sent the admin key in `X-API-Key` in 56 examples, which the Admin API does not read, so each of them returned 401. They now use `x-admin-api-key`, and the regenerate-secret response examples match what the endpoint returns ([#1705](https://github.com/idenplane/idenplane/pull/1705)).

### Changed
- **client_credentials no longer returns a `refresh_token`, `id_token` or `session_state` for a client with a service account**, as RFC 6749 §4.4.3 asks and as clients without a service account already behaved. The access token keeps the service account's claims and roles but no `sid`. Ask for a new token when one expires. Each token request also writes nothing to the database any more, where it used to create a session and a refresh token and prune old sessions. Disabling the service account, or revoking a token, still ends it. In the benchmark harness on 2 CPUs this grant went from 41 to 143 requests per second, with p95 from 3.1 s to 0.33 s.
- **Client secrets and service-account API keys are checked in microseconds instead of one Argon2 run per request.** Every token, introspection, revocation and API-key request used to pay 64 MiB and three passes of Argon2id, which capped throughput and queued behind user logins. Secrets Idenplane generates (256 random bits) are now stored as SHA-256 and compared in constant time; a slow hash protects nothing against a 2^256 search. Secrets that came from another system and may have been chosen by a person stay on Argon2id. Existing secrets move to the new format the first time they are used, with no rotation needed ([#1702](https://github.com/idenplane/idenplane/pull/1702)).
- Realm import keeps a client secret hash from an export made with secrets, and hashes a plaintext secret written into the file by hand.
- The benchmark harness runs on Docker Desktop and with locally built images ([#1703](https://github.com/idenplane/idenplane/pull/1703)).

## [0.5.1] - 2026-11-07

Forward auth did not work in 0.5.0. This release fixes it and checks it against real Traefik, nginx and Caddy. **If you use forward auth, upgrade, and update your nginx config** (below).

### Fixed
- **Forward auth could not sign anyone in** ([#1699](https://github.com/idenplane/idenplane/pull/1699)). Three server bugs, each enough on its own:
  - `verify` redirected to a relative URL. Traefik resolved it against Idenplane's internal address, so browsers were sent to a host they cannot reach. The redirect is now absolute, built from `BASE_URL`.
  - `start` sent the browser to an authorize path that does not exist (404). It now uses `/protocol/openid-connect/auth`.
  - `callback` sent the client's stored secret hash as its secret, so every confidential client failed with `invalid_client`. Idenplane now redeems the code itself, with PKCE in place of the secret.
- **Forward auth with nginx returned 500 on every page.** `auth_request` cannot pass a redirect on. Requests from nginx now get a 401 and the sign-in URL in `X-Idenplane-Login`, and the guide's nginx config redirects to it. **Update your nginx config to the one in the guide.** The old one also redirected to the internal `idenplane:3000` address.
- The forward-auth example (`examples/forward-auth-traefik`) failed at setup: its seed sent fields the admin API rejects, and Traefik 3.3 cannot talk to Docker Engine 29.

### Security
- A forward-auth sign-in is now bound to the browser that started it. A callback link opened in another browser fails instead of signing that browser in, including a link an attacker made for their own account (login CSRF).

### Changed
- Benchmarks: removed comparison numbers that no benchmark ever produced ([#1696](https://github.com/idenplane/idenplane/pull/1696)), and added a reproducible Idenplane vs Keycloak harness ([#1698](https://github.com/idenplane/idenplane/pull/1698)).
- CI runs the forward-auth example end to end on every PR, and pins the PostgreSQL 16 client for the backup tests ([#1697](https://github.com/idenplane/idenplane/pull/1697)).

## [0.5.0] - 2026-11-07

SMS becomes a real second factor, "Require MFA" is enforced on every way in, the server moves to NestJS 12 and Node 24, and Idenplane can sit in front of other apps as a forward-auth proxy.

### Added
- **SMS multi-factor authentication** ([#1690](https://github.com/idenplane/idenplane/pull/1690), [#1691](https://github.com/idenplane/idenplane/pull/1691)):
  - Users add, change and remove a phone on the account page, and sign in with a texted code.
  - Realms that require MFA can let new users enrol a phone instead of an authenticator app.
  - Step-up and the token API accept texted codes: `mfa_methods` on `mfa_required`, `POST …/openid-connect/mfa/sms`, and `mfa_method=sms` on the `mfa_otp` grant.
  - Codes are bound to the sign-in they were sent for, capped at 5 guesses per challenge, single-use, and stored only as keyed hashes. Phone numbers are encrypted.
  - Sending is limited per challenge, user, phone, IP and realm (`SMS_REALM_HOURLY_LIMIT`).
  - The admin console can switch SMS MFA on (a provider is required), list a user's factors, and remove just the phone.
- **Forward-auth proxy mode** for Traefik, nginx and Caddy, managed from the admin console, with a guide and a runnable Traefik example ([#1486](https://github.com/idenplane/idenplane/pull/1486), [#1487](https://github.com/idenplane/idenplane/pull/1487), [#1488](https://github.com/idenplane/idenplane/pull/1488))
- Admin MFA status lists the user's `methods`, and `DELETE …/users/:id/mfa/sms` removes only the phone
- Contributor setup guide and coding standards ([#1511](https://github.com/idenplane/idenplane/pull/1511)), and a release-process page ([#1515](https://github.com/idenplane/idenplane/pull/1515)). The setup guide's steps now run in CI on Linux, macOS and Windows (WSL) ([#1692](https://github.com/idenplane/idenplane/pull/1692))

### Changed
- **Upgraded to NestJS 12** ([#1665](https://github.com/idenplane/idenplane/pull/1665)). CI and the Docker image run on **Node 24** ([#1651](https://github.com/idenplane/idenplane/pull/1651)).
- **Every second-factor check now counts any factor** (authenticator app or SMS). Before, it counted only TOTP.
- `DELETE /admin/realms/:realm/users/:id/mfa` removes **every** second factor and the recovery codes. Use `…/mfa/totp` or `…/mfa/sms` to remove just one.
- **Recovery codes** are kept while the user still has another factor, and enrolling a second factor no longer replaces them.
- Theme pages fall back to English for any message a locale hasn't translated, instead of showing the raw key.
- Java SDK moves to Spring Boot 4 and Spring Security 7, released separately as `java-v1.1.0` ([#1499](https://github.com/idenplane/idenplane/pull/1499), [#1514](https://github.com/idenplane/idenplane/pull/1514)).

### Fixed
- **Security:** a realm's "Require MFA" setting could be bypassed. An unenrolled user could get a single-factor SSO session that `/authorize` and SAML accepted. Sessions now record the level they reached, and enrolment is required before any session is issued ([#1686](https://github.com/idenplane/idenplane/pull/1686)).
- **Security:** federated (social / IdP) sign-ins skipped TOTP, consent and the disabled-user check, and could link to an existing account through an unverified email. They now go through the same login flow as passwords ([#1687](https://github.com/idenplane/idenplane/pull/1687)).
- **Security:** email provider keys were returned by the admin API, and the SMTP password was stored unencrypted. Both are now redacted and encrypted, and are kept when a form is re-saved ([#1688](https://github.com/idenplane/idenplane/pull/1688)).
- **Security:** two parallel submissions of the same correct code could each complete a sign-in. MFA challenge attempts and recovery codes are now claimed atomically.
- **Security:** reserved render options can no longer be smuggled into theme templates ([#1685](https://github.com/idenplane/idenplane/pull/1685)).
- Removed a malicious secret-exfiltration workflow that had been pushed to the repository ([#1650](https://github.com/idenplane/idenplane/pull/1650))
- Realm SMS settings now save, stay encrypted and take effect ([#1684](https://github.com/idenplane/idenplane/pull/1684))
- `webAuthnUserVerificationRequired` is accepted and persisted on realms ([#1682](https://github.com/idenplane/idenplane/pull/1682))
- `npm run db:setup` failed on every fresh checkout, because the seed didn't load `.env` ([#1692](https://github.com/idenplane/idenplane/pull/1692))
- The Docker `latest` and `main-<sha>` tags were never published on pushes to `main` ([#1413](https://github.com/idenplane/idenplane/pull/1413))

### Security
- All open Dependabot and code-scanning alerts resolved. Dependencies updated across the server, admin console, docs, SDKs and examples.

## [0.4.0] - 2026-08-04

Native Java and Android SDKs reach Maven Central, `idenplane-mcp` ships, and the admin console rounds out webhooks, organizations, SCIM, and plugin management.

### Added
- Native Java SDK (`idenplane-java`) — OIDC token validation, Spring Boot auto-configuration starter, Jakarta EE Servlet/JAX-RS filters, a Project Reactor wrapper, and a runnable sample app ([#1326](https://github.com/idenplane/idenplane/issues/1326))
- Android SDK reaches Maven Central — buildable with CI, unit-tested, Jetpack Compose helpers, a Compose quickstart demo app ([#1325](https://github.com/idenplane/idenplane/issues/1325))
- `idenplane-mcp` — first-party stdio MCP server for AI agent integration, including group-management tools
- `idenplane-go` and `idenplane-python` — Role and Group admin services
- Terraform provider — Identity Provider and User Federation resources
- Multi-provider email abstraction (Resend, SendGrid, Mailgun, Postmark, SMTP)
- SMS provider configuration UI with card-grid selector
- Admin UI: webhooks, service accounts, organizations, custom attributes, SCIM, authorization policies, plugins, impersonation, risk-assessment routing, an interactive migration wizard, a locked-out-accounts dashboard panel, a failed-login heatmap, and an expanded client template catalog (8 → 23 apps)
- Zitadel and Authentik migration importers, alongside the existing Keycloak/Auth0 tooling
- Real-time WebSocket push for session termination and step-up-required events
- Security email sent when a user changes their password; email notification when a session is terminated by continuous verification
- Production Docker Compose templates with Traefik+TLS and Nginx+TLS (Redis included)
- Next.js and framework-free vanilla JS quickstart examples; real-browser E2E test suite for the admin console
- Architecture Decision Records and a contributor architecture overview, published under docs/Contributing

### Changed
- Corrected the Java SDK's Maven groupId from `io.idenplane` to `com.idenplane`, matching the domains the project actually owns ([#1326](https://github.com/idenplane/idenplane/issues/1326))
- Split licensing: the server/core stays AGPL-3.0, every SDK/client package is MIT
- Centralized SDK bearer-token extraction, JWT decoding, and role resolution instead of duplicating it per-SDK

### Fixed
- Android SDK: `logout(activity)` now actually clears the browser-side session via a Custom Tab, matching what its doc comment always promised
- Off-by-one in the webhook durable-queue retry backoff
- Realm creation no longer skips its admin audit event

### Security
- Patched all outstanding Dependabot vulnerability alerts across the server, admin-ui, docs, and SDK packages

## [0.3.0] - 2026-05-21

Enterprise provisioning, GraphQL Admin, and the Idenplane rebrand under AGPL-3.0.

### Added
- SCIM 2.0 User Provisioning endpoints for enterprise IdP sync
- GraphQL Admin API alongside the REST surface
- Continuous Verification — step-up and termination services for in-session risk response
- Theme Builder with server-side live preview rendering
- Complete User Self-Registration Portal
- Automated upgrade & migration tooling
- Performance benchmark suite
- Phone-number fields for SMS OTP

### Changed
- Rebranded from AuthMe to Idenplane under AGPL-3.0
- Adopted "The Bracket" logo system ([#897](https://github.com/idenplane/idenplane/pull/897))

### Performance
- admin-ui: Vite proxy, query caching, React.memo

### Security
- Closed all 14 bug-reproduction vulnerabilities; full E2E green
- Closed IDOR in role removal
- Patched all Dependabot vulnerabilities across SDKs, docs, Java, and Go example ([#892](https://github.com/idenplane/idenplane/pull/892))
- Removed unused vulnerable xmldom direct dependency ([#891](https://github.com/idenplane/idenplane/pull/891))
- Bumped Go example deps to fully-patched versions ([#896](https://github.com/idenplane/idenplane/pull/896))

## [0.2.0] - 2026-03-26

A major expansion month: 5 new SDKs, the Visual Flow Designer, B2B organizations, and AI-powered risk assessment.

### Added
- Native iOS and Android SDKs ([#22](https://github.com/idenplane/idenplane/pull/22))
- Next.js, Vue, and Angular framework SDKs ([#23](https://github.com/idenplane/idenplane/pull/23))
- Visual Authentication Flow Designer (Feature 24)
- Custom Authentication Flow Engine (Feature #20)
- Organization & Team Management — B2B multi-tenancy ([#27](https://github.com/idenplane/idenplane/pull/27))
- Step-Up Authentication (Feature #19)
- Migration tools from Keycloak & Auth0 ([#134](https://github.com/idenplane/idenplane/pull/134))
- AI-powered Risk Assessment & adaptive auth ([#25](https://github.com/idenplane/idenplane/pull/25))
- API versioning & smooth upgrade system (Feature #17)
- Non-Human Identity (NHI) management (Feature #18)
- WebAuthn / FIDO2 passwordless authentication
- ABAC policy engine (Feature #10)
- Plugin & extension system (Feature #26)
- User impersonation for admin troubleshooting ([#271](https://github.com/idenplane/idenplane/pull/271))
- Webhook & event notification system ([#266](https://github.com/idenplane/idenplane/pull/266))
- Audit log export & streaming ([#269](https://github.com/idenplane/idenplane/pull/269))
- Per-client, per-user, per-IP rate limiting ([#265](https://github.com/idenplane/idenplane/pull/265))
- Redis session & cache layer ([#268](https://github.com/idenplane/idenplane/pull/268))
- i18n for Login & Account pages ([#270](https://github.com/idenplane/idenplane/pull/270))
- Multi-database support — SQLite, MySQL, PostgreSQL
- Official Kubernetes Helm chart (Feature #16)
- Custom user attributes & registration flows (Feature #15)
- CLI v1.0.0 with full management capabilities
- SDK v1.0.0 with advanced auth features

### Security
- SAML XML canonicalization & ACS URL validation
- TOTP replay attack & session fixation prevention
- Plugin integrity, MFA cross-realm, SAML digest, Docker defaults, IP spoofing hardening
- Per-realm rate limiting on token endpoint
- Production WEBHOOK_ENCRYPTION_SALT default blocked
- WebAuthn step-up ceremony verification + Docker entrypoint hardening
- 15 critical bugs fixed across all SDK packages
- 577 @ApiResponse decorators added + HTTP status codes corrected

## [0.1.0] - 2026-02-26

The foundation release: core IAM server with OAuth, OIDC, SAML, MFA, and the initial admin console.

### Added
- OAuth 2.0 endpoints — authorization code, refresh token, device flow, introspection
- OpenID Connect issuer + userinfo
- SAML 2.0 identity provider with signed assertions
- TOTP-based multi-factor authentication
- Realm-level `requireEmailVerification` setting
- Public self-registration page + "Register" link on login page
- Admin console — realms, users, clients, client scopes, protocol mappers, role mappings
- JavaScript SDK (`authme-sdk`) with NestJS/Express server-side integration
- AuthMe CLI for server management
- Server-side token revocation on admin logout

### Fixed
- 4 MFA/2FA bugs found during security audit
- Token & introspect endpoints returning 201 instead of 200
- TOTP setup template form action URL
- `removeUserRealmRoles` returning 200 instead of 204
- Login error messages never displayed on failed login

[Unreleased]: https://github.com/idenplane/idenplane/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/idenplane/idenplane/releases/tag/v0.5.0
[0.4.0]: https://github.com/idenplane/idenplane/releases/tag/v0.4.0
[0.3.0]: https://github.com/idenplane/idenplane/releases/tag/v0.3.0
[0.2.0]: https://github.com/idenplane/idenplane/releases/tag/v0.2.0
[0.1.0]: https://github.com/idenplane/idenplane/releases/tag/v0.1.0
