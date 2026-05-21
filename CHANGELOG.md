# Changelog

All notable changes to Idenplane are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For full per-commit detail, see the [GitHub Releases](https://github.com/idenplane/idenplane/releases).

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

[0.3.0]: https://github.com/idenplane/idenplane/releases/tag/v0.3.0
[0.2.0]: https://github.com/idenplane/idenplane/releases/tag/v0.2.0
[0.1.0]: https://github.com/idenplane/idenplane/releases/tag/v0.1.0
