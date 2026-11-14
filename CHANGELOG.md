# Changelog

All notable changes to Idenplane are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For full per-commit detail, see the [GitHub Releases](https://github.com/idenplane/idenplane/releases).

## [Unreleased]

### Security
- **Two admin API responses leaked sensitive data.** The setup wizard's endpoints returned the first administrator's password hash (`adminPasswordHash`). `GET /admin/realms/{realm}/user-federation/{id}` returned the whole realm record with the federation, including its settings and encrypted secrets. Both responses now leave these out.
- **A realm's CAPTCHA setting is now enforced on self-registration.** Before, `captchaEnabled` was not enforced anywhere. `POST /realms/{realm}/registration/register` verified a token only when the caller added `?captchaProvider=` **and** sent `captchaToken`, so a bot skipped the check by leaving out either one; with no `RECAPTCHA_SECRET_KEY` or `HCAPTCHA_SECRET_KEY` set, verification passed; and the hosted registration form had no CAPTCHA at all. Now both entry points run one server-side check (`CaptchaService.verifyForRealm`) before anything is looked up or created. The provider and keys come only from the realm, and the realm's encrypted secret is used, with the environment variable as a fallback only when the realm has none. The check fails closed. A missing token is `400 CAPTCHA required`. A refused token, a reCAPTCHA v3 token with another action than `register` or a score under `captchaScoreThreshold`, or a reCAPTCHA response without a score (a v2 key) is `400 CAPTCHA verification failed`. An incomplete realm configuration, or a provider that is unreachable or slower than 5 seconds, is `503`. The user's IP is sent as `remoteip`, and for hCaptcha the realm's site key as `sitekey`. Provider error codes are logged, no longer returned. The hosted form also requires the hostname of `BASE_URL` (the API does not, since its callers host the widget on their own domains). The built-in `idenplane` and `midnight` register pages render the hCaptcha checkbox or run reCAPTCHA v3 on submit, and that page's CSP admits exactly the provider's origins, only while CAPTCHA is on. See the new *Self-Registration and CAPTCHA* guide. **Before you upgrade:** a realm with `captchaEnabled: true` but no provider, site key or secret now refuses every self-registration with `503`; complete or turn off its CAPTCHA settings. API clients of such a realm must send `captchaToken` (reCAPTCHA v3 with the action `register`). The `captchaProvider` query parameter and `RECAPTCHA_SCORE_THRESHOLD` are no longer read. Custom `register.hbs` templates must render the widget from the new `captcha` value, as the built-in ones do. No migration.
- **Hosted pages can no longer be framed.** The login, registration, consent, account and device pages send their own Content-Security-Policy, which replaced helmet's and so dropped its `frame-ancestors`, `object-src` and `base-uri`, leaving them open to clickjacking. Their policy now includes `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` and `script-src-attr 'none'`. `form-action` stays off on these pages: browsers apply it to the redirect after a form POST, which would block the login's redirect to the client's `redirect_uri`. **Before you upgrade:** an app that shows the hosted pages in an iframe must open them in a top-level window or popup instead.
- **The realm API no longer returns CAPTCHA secret keys.** `recaptchaSecretKey` and `hcaptchaSecretKey` came back as their stored ciphertext; they now come back as the hidden-value placeholder `••••••`, like the SMTP password, and sending the placeholder back on create or update keeps the stored key. A value typed after the placeholder is `400`.
- **The device authorization endpoint authenticates confidential clients** (RFC 8628 §3.1). `POST …/protocol/openid-connect/auth/device` accepted any `client_id` without its credentials, so anyone who knew a confidential client's id could start device flows as that client. It now authenticates clients exactly as the token endpoint does: secret in the body, HTTP Basic, or a client certificate. A public client still sends only its `client_id`. **Before you upgrade:** confidential device clients must send their credentials to this endpoint, as they already do at the token endpoint. An unknown or disabled client now gets `401 invalid_client` instead of `404`.
- **Realm export and import no longer drop security settings.** The export copied only a hand-picked subset of fields, and the import created the realm from that subset. A realm moved this way silently lost its sign-in protection: email verification, WebAuthn and SMS MFA, OTP settings, adaptive authentication and risk thresholds, the session limit, rate limits, CAPTCHA, registration restrictions, impersonation limits, mTLS client authentication, auth flows and their bindings, and each client's step-up, token endpoint authentication, `tlsClientAuth*` rules and certificate-bound tokens. Group role mappings, service-account roles, TLS trust anchors, the certificate deny-list and client certificates were lost too. The export (format `version: 2`) now carries every realm and client setting and the other configuration tables. An allow-list next to the code, checked against `prisma/schema.prisma` by a test, makes every new column either exported or explicitly excluded with a reason. A failed import used to leave a half-created realm, and `overwrite` deleted the old realm before the new one was known to be valid. The import now runs in one transaction, so a failure leaves nothing behind and keeps the old realm. **Before you upgrade:** realms you already moved with an export file kept their defaults for the missing settings. Check them, or export and import them again after upgrading.

### Added
- **The certificate listener serves the session events WebSocket.** `MTLS_LISTEN_PORT` now upgrades `/ws/events` (that exact path; any other upgrade is `404`), so a client holding a certificate-bound access token can open the WebSocket over mutual TLS without a TLS-terminating proxy. The gateway reads the peer certificate from the TLS socket, as the HTTP endpoints on the listener do, and refuses a bound token over another certificate or none with `401`. The main port and the listener share one WebSocket server, and attaching a server twice registers one handler. On shutdown open sockets get a `1001` close frame and the listener ends any upgraded socket left, so an open WebSocket no longer keeps the process from stopping. See *mTLS Client Authentication*.
- **Email-code, sign-in-link and social steps for custom auth flows.** A bound flow can now use three more step types; the validator accepts them and the runtime runs them, all behind `AUTH_FLOW_RUNTIME_ENABLED` as before. `email_otp` (a second factor) emails a code to the identified user's verified address: only a keyed hash is stored, bound to the login transaction, each guess is counted before a constant-time comparison, a code works once and expires within the transaction, and sends and guesses are limited per transaction and per user. `magic_link` (identifying) emails a sign-in link that works only in the browser that asked for it, while that login is in progress; opened anywhere else (another browser, a mail scanner) it shows an error and changes nothing. It reuses the magic-link table, limits and email template, answers the same for unknown addresses, and the standalone `/magic-link/verify` never accepts it. `social` (identifying) signs in at a realm identity provider named by `providerAlias`, which must exist and be enabled; the provider's callback finishes the step only in the transaction and browser that started it, once, and the client's `state` and PKCE are kept. After identification a social step never creates an account and refuses another user's. A flow sign-in's `acr` is computed from the kinds of step passed: a second factor of a different kind than the identifying step makes MFA, so a link plus an emailed code (one mailbox), or a password plus a social sign-in, stays at the password level. `amr` is `otp` for an emailed code and a sign-in link, and empty for a social sign-in. New hosted pages `email-otp` and `magic-link` in both built-in themes. See *Custom Auth Flows → Email, link and social steps*. No migration.
- **`ENFORCE_ACR_ON_FRESH_LOGIN`, off by default.** With `true`, a fresh sign-in honours what the authorization request asks of `acr`. `/auth` relays the `claims` parameter, and the built-in login forms carry `acr_values` and `claims` (custom themes should add these two hidden fields, as `login.hbs` does). An `acr` requested as an Essential Claim is then mandatory, like a client's `requiredAcr`: the user answers their second factor or enrols one, and a level the sign-in cannot reach (a passkey level on a password sign-in, or only unknown values) ends with `unmet_authentication_requirements` instead of a code at a weaker level. SSO with `prompt=none` answers `interaction_required` when the session is weaker, and a bound flow treats the essential `acr` as mandatory too. `acr_values` stays voluntary.
- **Groundwork for client certificates (RFC 8705 mTLS), off by default.** New `MTLS_*` settings (see *Environment Variables*) add an optional HTTPS listener and support for a certificate forwarded by a TLS-terminating proxy. The listener asks each client for a certificate and serves only the OAuth endpoints a client needs. The proxy header counts only from addresses in `MTLS_TRUSTED_PROXY_CIDRS`, which refuses `*`, `0.0.0.0/0` and `::/0`. From any other peer the header is rejected with `400 invalid_request`, or stripped when `MTLS_PROXY_UNTRUSTED_HEADER_ACTION=strip`. Invalid settings stop the server at startup.
- **OAuth client authentication with TLS client certificates (RFC 8705), off by default.** A client can authenticate at the token, introspection and revocation endpoints with `tls_client_auth` (a certificate from one of the realm's CAs that matches the client's one subject DN or SAN rule) or `self_signed_tls_client_auth` (a certificate registered for the client). It works only with `MTLS_ENABLED=true` and the realm's new `mtlsClientAuthEnabled`; otherwise such a client gets `401 invalid_client`. Clients gain `tokenEndpointAuthMethod` (an explicit `client_secret_basic` or `client_secret_post` now accepts only that method; unset keeps today's behaviour) and the `tlsClientAuth*` rules. New admin endpoints manage a client's certificates (`…/clients/:clientId/tls-certificates`), a realm's trust anchors (`…/tls-trust-anchors`) and its deny-list (`…/tls-revoked-certificates`). Certificate paths are validated in the application: CA flag, `keyCertSign`, path length, `MTLS_MAX_CHAIN_DEPTH`, `clientAuth` usage, and refusal of `nameConstraints` and unknown critical extensions. `MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE` failures per certificate answer `429 slow_down`. Discovery lists the two methods and `mtls_endpoint_aliases` (from `MTLS_BASE_URL`) only for realms that turn them on. See the new *mTLS Client Authentication* guide. A migration adds two realm flags and seven client columns, all defaulting to off or empty, and three tables: `client_tls_certificates`, `realm_tls_trust_anchors` and `tls_revoked_certificates`.
- **Certificate-bound access tokens (RFC 8705 §3), off by default.** A client with the new `tlsClientCertificateBoundAccessTokens` setting gets access tokens carrying `cnf: {"x5t#S256": …}`, the thumbprint of the certificate it presented at the token endpoint, with any grant and any authentication method. Without a certificate its token request is `401 invalid_client`. `cnf` is set after protocol mappers and plugins, which cannot change or remove it. A confidential client's refreshed token is bound to the certificate presented at the refresh; a public client's refresh token is bound too, and refreshing it with another certificate is `400 invalid_grant`. Introspection returns `cnf`. Userinfo, the session events WebSocket and admin bearer authentication accept a bound token only with its certificate (from the certificate listener or a trusted proxy), otherwise `401 invalid_token` with a `WWW-Authenticate: Bearer` challenge. Discovery advertises `tls_client_certificate_bound_access_tokens: true` for realms with certificate authentication on. Clients without the setting are unchanged. The JavaScript SDK's `verifyToken` takes `{ certificate }` (DER) or `{ certificateThumbprint }` and rejects a bound token without a matching certificate; `computeX5tS256` is exported. A migration adds `refresh_tokens.cnf_x5t_s256`.
- **Explicit auth-flow bindings.** A realm can bind a browser flow (`browserFlowId`) and each client can override it, through `GET`/`PUT /admin/realms/{realm}/auth-flows/bindings` or the new *Flow bindings* panel on the admin console's Auth Flows page. A per-realm switch (`authFlowsEnabled`, off by default) and the server flag `AUTH_FLOW_RUNTIME_ENABLED` gate them. They take effect at login with the flow runtime (below); the console notes when the server runs without it. `POST …/auth-flows/{id}/validate` checks a stored flow, and flows now carry a `version` that increments on every update. A migration adds `realms.browser_flow_id`, `realms.auth_flows_enabled` and `authentication_flows.version`. `isDefault` is deprecated and never used for binding.
- **NHI identities authenticate with their own certificates (RFC 8705), off by default.** A device or workload gets an OAuth client with `POST /admin/realms/{realm}/nhi/{id}/oauth-client` (`GET` and `DELETE` too): confidential, `client_credentials` only, no secret and no service account, always issuing certificate-bound tokens. It authenticates at the realm's token endpoint with `self_signed_tls_client_auth` or `tls_client_auth` against the identity's certificate credentials. Credentials gain `tlsAuthMode` (`SELF_SIGNED` pins a certificate by `x5t#S256`; `PKI` names one subject or SAN rule for certificates from the realm's trust anchors) and a computed `status` (`active`, `grace`, `revoked`, `expired`, `not_yet_valid`, `disabled`, `identity_inactive`); only `active` and `grace` authenticate. Rotating a certificate credential keeps the old one working for an overlap (`overlapSeconds`, else the policy's new `rotationOverlapSeconds`, default 24 hours), in one transaction, with at most 10 live certificates per identity. Their tokens name the credential that accepted the certificate (private claims `nhi_cid`, and `nhi_crt` with a PKI certificate's issuer and serial, protected from mappers and plugins). Introspection skips the user lookup and checks that exact credential: revoking it, or the end of its rotation grace period, ends its tokens at once, as does a deny-list entry by thumbprint or by issuer and serial. Each certificate authentication updates the credential's `lastUsedAt` and `requestCount` and writes an NHI audit entry (`ACCESS_GRANTED` or `ACCESS_DENIED`), without delaying the response. It needs `MTLS_ENABLED` and the realm's `mtlsClientAuthEnabled`, and the identity must be `ACTIVE`. See *Devices and workloads* in the mTLS guide. A migration adds `clients.nhi_identity_id`, `nhi_credential_policies.rotation_overlap_seconds` and, on `nhi_credentials`, `realm_id` (backfilled from the identity), `tls_auth_mode`, `cert_thumbprint_s256` (backfilled from stored PEMs), certificate metadata, PKI rule columns, `superseded_by_id` and `rotation_grace_until`. Database triggers keep a client and its identity, and a credential and its identity, in the same realm.
- **Encryption key rotation.** `WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT` can now be changed without losing the stored secrets. Set the new values, and the old ones as `WEBHOOK_SECRET_KEY_PREVIOUS` and `WEBHOOK_ENCRYPTION_SALT_PREVIOUS` (either one defaults to the current value). The previous key only decrypts; everything is encrypted with the current key.
  - **On start**, under the existing database lock, Idenplane:
    1. checks that the key check row decrypts with the old key;
    2. reads every encrypted value;
    3. re-encrypts with the new key, in batches with compare-and-set writes, each value still under the old key: realm, identity provider, LDAP, audit stream, SSO, signing-key, webhook, NHI, SMS-phone and TOTP secrets;
    4. moves the key check row to the new key, last. It then logs `Key rotation complete` with both key ids; remove the previous variables then.
  - **Refusals.** A previous key that is not the key in use refuses the start before anything is written. So does a value that decrypts with neither key; the error names each one. `STORED_SECRETS_ACCEPT_UNREADABLE=true` (one start) leaves such values in place and logs them.
  - **Interruptions.** A rotation cut short resumes on the next start, and a second run writes nothing.
  - **Duration.** About 5,000 TOTP or SMS factors per second were measured, roughly 3 to 4 minutes per million.
  - **What is lost.** Pending one-time codes and flow sign-in links are hashed with the current key, so they must be requested again after a rotation. SMS send limits start a new window.
  - **New ciphertext format.** Values encrypted from this version on are `ek1.<key id>.<base64>`, with the key id (derived from the key, never the key itself) bound as authenticated data. Values written by earlier versions still decrypt, and are rewritten in the new format only when they are rotated. As with the encryption-at-rest change above, an older version cannot read these values.
  - **Charts and docs.** The Helm chart gains `secrets.WEBHOOK_SECRET_KEY_PREVIOUS` and `secrets.WEBHOOK_ENCRYPTION_SALT_PREVIOUS`, never generated. See *Production → Rotating the encryption key*.
  - **`npm run backfill:encrypt-realm-secrets`** leaves values in the new format alone.

### Changed
- **A password posted on a passwordless flow step no longer ends the sign-in.** On a bound flow's passkey or social step without a password fallback, a custom theme that ignores `passkeyOnly` and `passwordFormHidden` still shows its password form, and submitting it ended the login transaction with "This sign-in step was not expected". Now the password is not checked, nothing about the transaction changes and no failure is counted, and the user is sent back to the same step with "This step signs in with a passkey. Use your passkey to continue." (or the identity-provider equivalent). Every other submission for the wrong step still ends the transaction.
- **Custom themes are checked for the password-form flags.** When the server loads the themes, a theme whose own `login.hbs` reads neither `passkeyOnly` nor `passwordFormHidden` (the template is parsed, comments don't count) is logged with a warning, and `GET /admin/realms/themes` returns it in each theme's new `warnings` list, shown on the realm's **Theme** tab in the admin console. A theme that inherits its parent's `login.hbs` gets the parent's result. Warnings never stop a theme from loading. See the new *Custom Themes* guide, which documents the login template context.
- **The midnight theme's registration page shows the terms-of-service checkbox and custom attributes.** Without them a realm with a terms URL, or a required registration attribute, could never register under that theme. It now matches the idenplane theme, including the approval notice.
- **The admin console's sign-up link opens the hosted sign-up page.** The new public console route `/console/register/{realm}` sends the browser to the realm's hosted, themed page (`/realms/{realm}/register`), keeping the query string (so `client_id`, `redirect_uri` and the other OAuth parameters reach the page). The hosted page is now the only sign-up implementation, with one CAPTCHA and Content-Security-Policy story: it renders the realm's provider, admits that provider's origins on that page only, and handles terms and custom attributes. The console's unrouted `PublicRegistrationPage` and `CaptchaWidget` are removed: they read the realm through the admin-only API and ran under the console's `script-src 'self'` policy, which blocks the provider's script. *Registration Settings* shows the link while self-registration is on.
- **Realm CAPTCHA settings are validated.** Creating or updating a realm with `captchaEnabled: true` is now `400` without a `captchaProvider` of `recaptcha` or `hcaptcha`, without that provider's site key, or without its secret key (in the realm or `RECAPTCHA_SECRET_KEY` / `HCAPTCHA_SECRET_KEY`). Any other `captchaProvider` value is `400` too. An update is checked only when it changes a CAPTCHA field, against the stored values for the fields it leaves out, so other edits to an older realm still go through.
- **Auth-flow validation accepts `email_otp`, `magic_link` and `social`.** Only `consent` is still refused with `unsupported_type`. A `social` step needs `providerAlias` (`config_missing_key`), naming an enabled identity provider of the realm (`provider_not_found`). The provider is checked again at every login, so deleting or disabling it makes the binding fail closed with the `503` page. `email_otp` takes `otpLength` (6 or 8) and `expirySeconds` (60–600), `magic_link` takes `expirySeconds`. The admin console's step palette no longer marks these steps *coming*, offers *Magic Link*, and its email-code length choices match the server (6 or 8).
- **Passkey sign-in finishes like a password sign-in.** It now goes through the same completion (`LoginFlowService.finishLogin`) and the same risk gate: a blocked sign-in gets no session, and a risk step-up is met by the passkey itself. "Remember me" applies to it, and the login page's passkey script sends `prompt` (and, with `ENFORCE_ACR_ON_FRESH_LOGIN`, `acr_values` and `claims`) from the form.
- **On a bound login, the login page shows only the identity providers of the current step**, and hides the password form for a social step without a password fallback (`passwordFormHidden`; `passkeyOnly` is unchanged).
- **Stricter auth-flow validation.** Creating or updating a flow now returns `400` with every problem as `errors: [{path, code, message}]`. A flow must have 1–20 steps and use only `password`, `ldap`, `totp` or `webauthn` steps; `social`, `email_otp`, `magic_link` and `consent` are refused until the runtime supports them. Its first step must identify the user, be required and have no condition. Fallbacks must be acyclic, must not leave steps unreachable, and identifying steps may only fall back to identifying steps. Conditions may read only whitelisted fields, and each step's `config` is checked per type. Existing flows are not changed; use `…/validate` to check them. The admin console now starts new flows with a password step, because an empty flow is no longer valid.
- **Deleting a bound auth flow is refused.** `DELETE …/auth-flows/{id}` returns `409` with the realm and client bindings while the flow is bound. Before, deleting it silently unbound clients; the database reference is now `ON DELETE NO ACTION` instead of `SET NULL`. `PUT …/assign-client/{clientId}` now binds the flow in the path, returns `400` if the body names another flow or the flow fails validation, and returns `404` for a flow or client outside the realm. Clearing an assignment moved to `DELETE` on the same path.
- **One client authentication for the token, introspection and revocation endpoints.** These endpoints had separate copies of the same checks and now share one. Responses are unchanged except on introspection and revocation. There, HTTP Basic sent together with `client_secret`, or with a `client_id` naming another client, is now `400 invalid_request`, as on the token endpoint. A malformed Basic header there is now `401 invalid_client`; before, it was ignored. HTTP Basic now also works there when the body repeats the same `client_id`; before, a body `client_id` made the endpoints ignore the Basic credentials.
- **Internal refactor of the sign-in code, no behaviour change.** The password sign-in's risk, email-verification and password-expiry checks (`PrimaryAuthGatesService`), the second-factor check (`SecondFactorVerifier`), what follows a completed sign-in (`PostAuthService`) and SSO session creation (`SessionIssuer`) are now separate services. `SessionIssuer` is the only code that creates an SSO session; a lint rule enforces it. New end-to-end tests pin the password, TOTP, recovery-code, SMS and passkey sign-ins, consent, the account gates, risk, single sign-on and `prompt` handling.
- **`SessionIssuer` checks the flow binding.** It refuses a session from the built-in sign-in paths where the binding resolver says a login is bound to a flow (or misconfigured), and accepts a flow session only for a finalised transaction of the flow and version bound at that moment. The built-in first-factor continuation (`LoginFlowService.continueAfterPrimaryAuth`, used by federated sign-in) runs the same check first. Nothing changes while `AUTH_FLOW_RUNTIME_ENABLED` is unset or the realm's `authFlowsEnabled` is off.
- **Certificate credentials of NHI identities hold a certificate only.** Creating a `CERTIFICATE` or `MTLS` credential with `privateKeyPem`, or with a key inside `certificatePem`, is now `400`; the device keeps its private key. `certificatePem` must be exactly one valid certificate. API keys and other credential types are unchanged.
- **Rotating an NHI API key that was already rotated is `409`.** It collided on the replacement's name and answered `500`; rotate the replacement instead.
- **Every NHI query is scoped by realm.** Credential, identity and policy reads and writes now name the realm, not only the row id, and the rotation scheduler skips credentials already rotated.
- **Realm export format `version: 2`.** `GET /admin/realms/{realm}/export` returns every realm and client setting. It also returns authentication flows and their bindings (by name), group role mappings, client service accounts with their roles, TLS trust anchors, the deny-list, client certificates, SAML service providers, LDAP federation, custom attributes, registration fields, organizations, webhooks, audit log streams, ABAC and continuous-risk policies, consent categories, theme builder themes, SCIM mappings, service accounts, NHI credential policies and proxy applications. References use natural keys (flow name, `clientId`, scope name, role name + `clientId`, group name, username). Clients of NHI identities are left out and listed under `omitted`. Signing keys, user credentials, sessions, tokens and event logs are never exported. With `includeSecrets`, values encrypted at rest (SMTP password, CAPTCHA secret keys, email and SMS provider credentials, webhook secrets) are exported decrypted. The importing server encrypts them with its own key, so the two servers' `WEBHOOK_SECRET_KEY` need not match. Without secrets, the import disables identity providers, LDAP federations, SSO connections and webhooks that need one, and lists `warnings`. `POST /admin/realms/import` validates a version 2 file completely before writing: types, enums, unknown keys, unresolved references, duplicate names, client authentication rules, certificates, and the auth-flow validator on every flow. It answers `400` with `errors: [{path, message}]`. Version 1 files (`1`, `"1"`, `"1.0"`) import with the same mapping as before, now in one transaction; other versions are `400`. An import now also invalidates the replaced realm's cache and the CORS origin cache. **Before you upgrade:** scripts that read export files must handle `version: 2`; scope assignments moved from the top-level `clientScopeAssignments` into each client's `defaultScopes` and `optionalScopes`. Run `…/auth-flows/{id}/validate` on older flows before exporting, because a version 2 import refuses invalid flows. Realm names must be lowercase slugs.

### Removed
- **MySQL and SQLite are no longer listed as supported. Idenplane runs on PostgreSQL 16 or later only.** The server already worked only on PostgreSQL: it uses the PostgreSQL driver, PostgreSQL triggers, row locks and LISTEN/NOTIFY, and the MySQL and SQLite schema variants had fallen behind, so they could not run. Removed: `prisma/schema.mysql.prisma`, `prisma/schema.sqlite.prisma`, `scripts/use-mysql.sh`, `scripts/use-sqlite.sh`, the unused `src/database` provider layer and the `mysql2` dependency. The docs, README, `.env.example` and the dev compose file now say PostgreSQL only. The CLI's rollback restore now also accepts `postgres://` URLs.
- **`NhiCertificateGuard`, `MtlsGuard` and `CertificateValidator`.** They protected no route; devices authenticate at the token endpoint with their certificates instead (see above).

### Fixed
- **A custom theme that sets only some colours no longer breaks its pages.** A theme without every colour in `theme.json` made every hosted page answer `500`. Colours missing from a theme now come from its parent chain, then the defaults.
- **The `master` realm can no longer be deleted, disabled or replaced by an import.** Every administrator signs in through it, so deleting, disabling or overwriting it locked them all out of the console and the admin API. All three now return `400`.
- **Federated sign-ins no longer claim a password.** The token endpoint turned an empty `amr` into `["pwd"]`, so a sign-in through an identity provider was reported as a password sign-in. Such tokens now carry no `amr` claim, because the provider's methods are not known. `acr` is unchanged.
- **SAML responses name the ACS URL they are posted to.** `Recipient` and `Destination` always named the service provider's default ACS URL, even when the request used another of its allowed URLs, so a strict service provider rejected the response.
- **The magic-link email no longer states a fixed lifetime.** The default theme had two contradictory sets of magic-link texts ("15 minutes" and "5 minutes"), and the lifetime is configurable anyway.
- **The admin console offers only NHI credential types that authenticate.** It offered `JWT Bearer`, which the server refuses, and could not display the server's `JWT`, `OAUTH` and `MTLS` types.
- **An expired password no longer loses the sign-in.** After a sign-in was sent to change an expired password, the user landed on a bare login page and the application never got a code. The OAuth request (and "remember me") now waits server-side, keyed by the change token, never in the URL, and the sign-in continues after the change: the second factor or its enrolment, consent, then the code, at the level the password proved. Where the login is bound to a custom flow it starts again through `/auth` with the same request. A risk step-up still comes after the password-expiry and email-verification checks; tests now cover both.
- **A SAML sign-in that had to sign in first is answered.** An SP-initiated request without an SSO session went to the login page and was never answered: every sign-in without an OAuth client ended on the account page. Every sign-in (password, second factor, MFA enrolment, passkey, a custom flow) now continues to `/realms/{realm}/protocol/saml/resume`, which checks the service provider and its ACS URL again and answers the request once.
- **A `null` boolean in the client admin API is `400`, not `500`.** `enabled`, `requireConsent`, `backchannelLogoutSessionRequired`, `publicClient` and `tlsClientCertificateBoundAccessTokens` sent as `null` on create, `PUT` or `PATCH` reached the database and failed with `500`. Nullable fields such as `tokenEndpointAuthMethod`, `requiredAcr` and the `tlsClientAuth*` rules still accept `null`.
- **`POST …/mfa/sms` authenticates the client like the token endpoint.** It ignored HTTP Basic and the client certificate, so a client using Basic or `tls_client_auth`/`self_signed_tls_client_auth` could not request an SMS code. The certificate listener now also serves this endpoint.
- **Creating a user accepts `emailVerified`.** `POST /admin/realms/{realm}/users` refused the field with `400`, so a verified user took a second request. It is optional and defaults to `false`.
- **The `profile` scope now includes `updated_at`.** It was listed in the scope's claims but never sent. ID tokens and userinfo now carry it, in seconds since the epoch (OIDC Core §5.1), and discovery lists it in `claims_supported`.
- **Theme changes are recorded as admin events** (resource type `THEME`). Creating, updating, publishing, restoring and deleting a theme left no trace in the admin events.
- **The API reference reports the real server version**, not `0.1.0`. The docs now explain that each server serves its full reference at `/api` (Swagger UI) and `/api-json`, replacing a link to a page that did not exist.
- **`auth_time` no longer moves to the moment of consent.** After a fresh sign-in followed by the consent screen, the ID token's `auth_time` was the time the user clicked Allow. It is now the time they signed in, so `max_age` checks are exact.
- **Passkeys without a signature counter can sign in.** Most synced passkeys always report a counter of 0, which was rejected as a rollback; a counter of 0 is now accepted while it stays 0 (WebAuthn §6.1.1).
- **Passkey sign-in follows the password sign-in.** It validates the authorization request before creating a session, records a `LOGIN` event, honours `prompt=consent` and the client's required level through the same decision code, keeps all OAuth parameters, and checks email verification before counting the use of the passkey.
- **"Remember me" survives the second factor.** It was dropped when the user had TOTP or SMS enrolled.
- **A wrong MFA code no longer reads "Too many failed attempts"** when brute-force protection is off (the default). Successful MFA is now recorded as an `MFA_VERIFY` event, and a rate-limited SMS attempt stays on the SMS form.
- **A client that requires a passkey refuses a risky password sign-in directly** instead of first sending the user through TOTP.

### Security
- **The SAML request cookie no longer carries the request.** `IDENPLANE_SAML_REQUEST` held the AuthnRequest, ACS URL included, as unsigned base64 JSON. The request now waits server-side for 10 minutes and the cookie is an opaque token.
- **An SSO session answers a SAML request only if it may serve the realm.** Where the realm is bound to a custom flow, the session must be as strong as the flow requires of its user, as for an OAuth client; a misconfigured binding serves no one.
- **Federated sign-in refuses an identity provider's answer without a subject**, which would have linked every such answer to the same account, and refuses a callback for a provider disabled after the redirect.

### Removed
- **`FlowExecutorService`.** The unused executor (any step could be submitted, unsupported steps passed automatically, passkey results were taken from the caller, errors led to fallbacks and the TOTP rate limit was skipped) is replaced by the flow runtime. `AuthFlowService.executeStep` and `getNextStep`, used only by it, are gone too. The auth-flow admin API is unchanged.

- **Custom auth flows now run at login, off by default.** With `AUTH_FLOW_RUNTIME_ENABLED=true`, a realm's `authFlowsEnabled` switch on and a flow bound to the realm or the client, the hosted login runs that flow's `password`, `ldap`, `totp` and `webauthn` steps through the existing login, second-factor and passkey endpoints, so themes keep working. Each login is a server-side transaction (`pending_actions` rows of type `authn_txn`, cookie `IDENPLANE_AUTHN_TXN`). It lasts 10 minutes and pins the flow's id and version; a changed flow restarts the login. A restart goes back through `/auth` with the original request, so the binding, single sign-on and `prompt` apply again. It is the only source of the OAuth request (form fields are ignored) and is claimed once at the end. The cookie value changes once the user is identified. Fallbacks run only when a step fails, never after a lockout or an error, and a step after identification cannot switch user. The session's `acr`/`amr` come only from the steps passed, and a bound login is never weaker than the built-in one for the same user and client: a missing second factor or passkey step is added, or the user enrols in MFA. A missing or invalid binding shows a `503` page and never falls back. Where a login is bound, the built-in sign-in paths cannot create a session: a social (identity-provider) sign-in is refused with a themed `403` page before any second factor is asked for. An SSO session serves a bound client only if it meets what the flow requires of that user, with the flow's conditions evaluated for them (a condition on `risk.level` counts as holding); otherwise the user signs in again (`interaction_required` with `prompt=none`). The built-in themes hide the password form on a passkey step without a password fallback (`passkeyOnly`). See *Custom Auth Flows → Running Flows at Login*. No migration.

- **Secrets that were stored in plaintext are now encrypted at rest**, with the key from `WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT` that already encrypted the realm SMTP, CAPTCHA, email/SMS provider and webhook secrets. Newly encrypted: identity provider client secrets (OIDC and social), LDAP federation bind credentials, audit log stream HTTP header values, the secret-named keys of organization SSO connection configs (`clientSecret`, `password`, `privateKey`, `…Token`, `apiKey`…), realm signing keys, TOTP seeds and the setup wizard's SMTP password (which was also copied into the realm unencrypted). Each is decrypted only where it is used: the broker's token request, the LDAP bind, audit stream delivery, token and SAML signing, and TOTP checks. The admin API returns these secrets as `••••••`, as it does the realm secrets, and `••••••` sent back on an update keeps the stored value; the identity provider and LDAP API responses used to return the secret itself. The admin event trail no longer records LDAP bind credentials, audit stream headers or SSO connection secrets. Realm exports with `includeSecrets` carry them decrypted and the import encrypts them with its own key, as for the other encrypted secrets. A new `encryption_key_check` table lets every start prove the key is the one the secrets use: with another key, Idenplane **refuses to start** instead of reading ciphertext as plaintext or encrypting it again. Decryption now requires the full 128-bit GCM tag. See *Production → Encryption at rest*. **Before you upgrade:** back up `WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT` with the database; from this version they protect signing keys and TOTP seeds too, and can only be changed by rotating them (see *Added*). The first start of this version encrypts the existing plaintext values in place. Several replicas or workers of this version may start at once (the work runs under a database lock and is done once), but **do not run the previous version beside it**: an older process cannot read what this version encrypts, so its token signing, TOTP checks, LDAP binds and broker sign-ins would fail. Stop the old version first (scale to zero, or a `Recreate` deployment strategy) instead of a rolling update. Going back to the previous version after the first start needs the pre-upgrade database backup (the upgrade rollback restores it). In production the start refuses to run without a configured key. If the first start reports that stored secrets which look encrypted do not decrypt, restore the previous key; set `STORED_SECRETS_ACCEPT_KEY=true` for one start only if you know the key is right. `npm run backfill:encrypt-realm-secrets` is no longer needed.

## [0.7.0] - 2026-11-12

A security and correctness release. It closes vulnerabilities in LDAP federation, database TLS during migrations, the default admin password, device certificates, verification links, token claims, flow assignment and passkey sign-in; makes a fresh sign-in enforce a client's required authentication level; fixes every OpenID Connect failure the OpenID Foundation conformance suite's basic plan reported against 0.6.0; makes the Helm chart start with its defaults on official PostgreSQL and Redis images; gives Docker Compose a setup helper with unique secrets; and adds a production checklist. Read *Before you upgrade*: several defaults changed on purpose.

**Before you upgrade:**
- **First production start needs `ADMIN_PASSWORD`.** With `NODE_ENV=production` (the Docker image default), creating the initial admin now fails when `ADMIN_PASSWORD` is missing, `admin`, a documented placeholder, or shorter than 12 characters. Existing databases already have their admin and are not affected.
- **Root `docker-compose.yml` no longer has a built-in database password.** It reads `POSTGRES_PASSWORD` from `.env`. For an existing volume created with the old file, add `POSTGRES_PASSWORD=idenplane` to `.env` (changing the value does not rotate the password inside an existing volume). Ports 3000 and 5432 now listen on localhost only.
- **Helm:** the chart now creates a `<release>-idenplane-keys` Secret with `ADMIN_API_KEY`, `ADMIN_PASSWORD`, `WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT`. Values you set under `secrets:` win; empty ones are generated on first install and kept on upgrades. Rendering fails on the old placeholders (`change-me-in-production`, `REPLACE_WITH_STRONG_SECRET`, the production values' database password), so pass real values or leave the keys empty.
- **Helm with Argo CD, Flux or `helm template`:** these cannot read a stored Secret back, so generated keys would change on every render. Create the four keys yourself and set `secrets.existingSecret`.
- **Helm chart 0.3.0 drops the Bitnami PostgreSQL and Redis sub-charts.** Their `docker.io/bitnami` images are no longer published, so the bundled database could not start. The chart now runs the official `postgres` (17, Debian) and `redis` images and reuses the existing PostgreSQL volume and password. Before upgrading, take a `pg_dump`, then delete the old StatefulSets with `--cascade=orphan` (see *Upgrading from chart 0.2.x* in the Kubernetes guide). The bundled database and Redis passwords are now generated when empty.
- **Migrations:** two run on start. They add `auth_time` and `session_id` to authorization codes and `auth_time` to sessions; all are nullable.
- **A client's `requiredAcr` now applies to a fresh sign-in too**, not only to SSO. A client that requires MFA sends a password-only user through TOTP enrolment (or their existing second factor) before it gets a code; a client that requires a passkey gets `access_denied` for a password sign-in. Check clients that set `requiredAcr`.
- **The SSO cookie is `SameSite=Lax`** (was `Strict`), so applications on other sites see the session on the authorization and logout redirects. Custom themes should add `<input type="hidden" name="prompt" value="{{prompt}}">` to `login.hbs` and `register.hbs` for `prompt=consent` to survive the form; without it nothing breaks, consent just isn't forced.

### Added
- **Production checklist** in the deployment docs: public HTTPS, secrets, a verified TLS connection to the database, and off-host backups with a restore check.
- **Next.js example: server-side sessions and a protected API.** The quickstart can keep tokens on the server in PostgreSQL behind an HTTP-only cookie, with refresh, sign-out, encrypted backup/restore and scheduled cleanup; `/api/profile` verifies the access token on the server and only returns the caller's own profile. A new CI workflow runs these flows against an image built from the commit, over HTTP and HTTPS.
- **`scripts/setup-env.cjs`** writes a `.env` with unique random database, admin, API and webhook secrets for Docker Compose or a source checkout. It refuses to overwrite an existing `.env`, so keys that encrypt stored data are never replaced. The README and Quickstart use it.

### Security
- **Database migrations verify the server certificate.** With `DATABASE_URL=…?sslmode=verify-full&sslrootcert=<ca>`, the server verified the database certificate, but Prisma's migration engine, which reads different parameter names, encrypted without verifying it. The Docker image now translates the parameters for `prisma migrate deploy`; `DATABASE_MIGRATION_URL` overrides the URL used for migrations.
- **A fresh sign-in ignored the client's required authentication level.** Only the SSO path enforced `requiredAcr`, so a client requiring MFA got a password-only code from the login form. See *Before you upgrade*.
- **A risky sign-in skipped email verification and password expiry.** The risk step-up redirected to the second factor before those checks; they now run first.
- **Passkey sign-in challenges were shared per realm.** Every usernameless sign-in, and anyone calling the options endpoint, replaced the same stored challenge, so concurrent sign-ins failed and could be disrupted on purpose. Each browser now gets its own challenge, bound by an `HttpOnly` cookie, and verification uses only that one. Passkey sign-in also enforces email verification.
- **NHI credentials no longer return stored private keys.** Listing, reading or creating a credential returned a `privateKeyPem` that had been supplied for it. It is never returned now, and a newly supplied key is encrypted at rest.
- **Assigning an auth flow to a client was not scoped to the realm.** `PUT /admin/realms/{realm}/auth-flows/{id}/assign-client/{clientId}` changed a client of any realm and accepted a flow of any realm. Both must now belong to the realm in the path.
- **Protocol mappers and token-enrichment plugins can no longer change protected token claims.** A mapper or plugin producing `sub`, `aud`, `azp`, `iss`, `scope`, `acr`, `amr`, `sid`, `cnf` or `nbf` could rewrite who or what an access token speaks for; those claims keep the server's values now. In ID tokens, user attributes can no longer replace registered claims.
- **`client_credentials` tokens of clients without a service account carried any requested scope.** The scope is validated like every other grant's.
- **The first production admin can no longer be `admin`/`admin`.** See *Before you upgrade*.
- The Docker build context excludes `.env*`, `.npmrc`, nested `node_modules` and other local files at every level.
- **LDAP federation now verifies the directory server's certificate.** `ldaps://` connections reject an untrusted or mismatched server certificate, and `startTls` on an `ldap://` URL performs a real StartTLS upgrade, with the same checks, before any bind. Every connection is closed after use, and an empty password is refused instead of being sent as an anonymous bind. A directory signed by a private CA needs that CA trusted by the server (for example with `NODE_EXTRA_CA_CERTS`).
- **The mTLS guard no longer trusts certificate headers.** It reads the peer certificate from a verified TLS connection only; `X-Client-Certificate` and `X-Client-Certificate-Fingerprint` request headers are ignored. The unfinished NHI certificate-authentication route now refuses every request until certificates are bound to a tenant-scoped credential.
- **Verification links are bound to their realm.** Password-reset, password-change and email-verification tokens are only accepted on the realm of the user they were issued to. A token presented on another realm is rejected and stays unused.
- **Removed the `hbs` package.** Login pages render through a small built-in view engine on the existing `handlebars` package, with fixed runtime options, a bounded template cache, and template and layout paths confined to the themes directory. Request data can no longer select engine options or the layout. Themes and translation helpers work as before.

### Changed
- **Login, OAuth, step-up and WebAuthn no longer depend on each other in a cycle.** Their services now live in core modules (`LoginCore`, `OAuthCore`, `StepUpCore`, `WebAuthnCore`) and shared types and constants in `src/authn-core`, which also removes every `forwardRef` between them. CI now fails on new import cycles in these modules (`npm run lint:cycles`). As a side effect, `LoginService`, `StepUpService`, `CryptoService` and `PrismaService` each have one instance again: the brute-force module had created second copies, so the step-up cleanup ran twice per interval and brute-force records used a second database pool.
- **The admin console loads each page on demand.** Every page is its own code chunk, so the first load no longer downloads the whole console: the main bundle went from 877 kB to 138 kB (158 kB to 44 kB gzipped). The shell stays on screen with a short loading state while a page loads.

### Fixed
- **Single sign-on and sign-out across sites.** The `Strict` SSO cookie was not sent on redirects from applications on other sites, so they always saw the login page and RP-initiated logout did not end the session.
- **`prompt=consent` is honoured on a fresh sign-in**, not only with an existing session.
- **The token endpoint accepts `client_secret_basic`.** Discovery advertised it, but `/token` ignored the `Authorization: Basic` header, so clients that use it by default (most OIDC libraries and the OpenID conformance suite) got `invalid_client`. Sending Basic together with `client_secret`, or with a different `client_id`, is rejected as `invalid_request`. Discovery no longer advertises `private_key_jwt`, which is not implemented.
- **Introspection reported `client_credentials` tokens of clients without a service account as inactive.** They are active while the client exists and is enabled.
- **JavaScript SDK: sign-out ends the single sign-on session.** `logout()` revokes the refresh token and then sends the browser to the provider's end-session endpoint with `id_token_hint` (and `post_logout_redirect_uri` when configured), so the next sign-in asks for credentials again. The PKCE verifier and state are kept in a separate, client-scoped login transaction that expires after 10 minutes and survives the full-page redirect even when tokens use in-memory storage.
- **NHI device certificates are real X.509.** Generated certificates are standard X.509 signed with the requested key, with the requested validity, subject and SANs, and they parse with standard X.509 tooling such as Node's `X509Certificate`. Validation reads the real validity dates and rejects malformed or expired certificates.
- **`prompt=none` works with a valid session.** Silent authorization used to return `login_required` even when the user was signed in. It now completes without UI when the session, redirect URI, consent and requested assurance allow it, and returns `login_required`, `consent_required` or `interaction_required` otherwise.
- The integration-test database preflight no longer shells out to `prisma db execute`, so it works the same on Windows and Linux.
- **OpenID Connect conformance fixes**, found by running the OpenID Foundation conformance suite (oidcc-basic, static client) against Idenplane:
  - The UserInfo endpoint accepts POST, with the access token in the `Authorization` header or as a form `access_token` parameter (OIDC Core §5.3.1, RFC 6750). Sending it in both places is rejected.
  - The authorization endpoint accepts a form POST (OIDC Core §3.1.2.1).
  - `request` and `request_uri` are rejected with `request_not_supported` / `request_uri_not_supported` instead of being ignored, and discovery states `request_parameter_supported` and `request_uri_parameter_supported` as `false`.
  - `auth_time` is when the user signed in, not when the code was exchanged, including for codes issued from an SSO session. `max_age` is honoured: an older sign-in is repeated, or `prompt=none` returns `login_required`.
  - `offline_access`, advertised in discovery, is granted, with the realm's offline token lifespan, when a code-returning grant (authorization code, device) is used by a client that has the `offline_access` client scope assigned. Other grants never get it (OIDC Core §11).
  - When its own client presents a used authorization code again (authenticated, or with the PKCE verifier) within five minutes of the code's expiry, the session the code created ends, so its refresh token stops working and its access token introspects as inactive (RFC 6749 §4.1.2).
  - Discovery no longer lists `backchannel_logout_uri`, a client registration parameter rather than provider metadata; `backchannel_logout_supported` already advertises the feature.
- **The Helm chart did not start with its default values.** The default `ADMIN_API_KEY` was a placeholder the server refuses in production, and the chart never set `WEBHOOK_SECRET_KEY` or `WEBHOOK_ENCRYPTION_SALT`, which production requires. CI now installs the chart on a kind cluster, signs in with the generated password, upgrades it and runs `helm test`.
- **ID tokens issued by a refresh keep the original `auth_time`** instead of the refresh time (OIDC Core §12.2). This was the last failure of the OpenID conformance basic plan.
- Assigning a client scope that is already assigned answers 409 instead of 500.

## [0.6.0] - 2026-11-10

Idenplane gets much faster and runs correctly as several instances. Protocol requests no longer go to the database each time, and `WEB_CONCURRENCY` lets one container use every CPU. Scheduled jobs, webhooks, plugins and first boot now behave when more than one instance runs, and several security fixes land. With one worker per CPU, Idenplane served discovery, JWKS, client-credentials tokens and introspection faster than Keycloak 26.8 on the same machine. See the [benchmarks](docs/docs/benchmarks.md).

**Before you upgrade:**
- **Migrations:** five run on start. They add triggers and indexes, and remove duplicate used-TOTP rows before adding a unique index.
- **Connection pooler in transaction mode:** if Idenplane reaches PostgreSQL through PgBouncer with `pool_mode = transaction`, or a similar pooler, set `CACHE_L1=off` and `LEADER_ELECTION=off`. Notifications and the leader lock need a session. Session mode, or a direct connection, needs nothing.
- **Access log:** only failed requests are logged now. Set `LOG_ACCESS=all` to log every request as before.
- **Helm:** the chart used to default to an image tag that does not exist. See Fixed below.

### Added
- **Published benchmarks** against Keycloak, Zitadel and Authentik, measured on one machine with pinned images, CPUs and memory. The method, the results and the raw data are on the new Benchmarks docs page and in `benchmarks/published/`. The README and introduction now quote measured memory figures instead of estimates.
- **`WEB_CONCURRENCY` runs one worker per CPU** (`auto`, or a number), so one container can use the whole machine instead of about one core. A small primary process forks the workers, restarts one that crashes, stops the container if workers keep failing at startup, and stops them gracefully on SIGTERM; `/admin/metrics` reports the whole container. The default stays one process. The CPU count honours the container's cpuset and CPU quota (a Kubernetes CPU limit), and the Argon2, database-pool and throttle budgets are split between workers rather than multiplied.
- The server now shuts down gracefully on SIGTERM/SIGINT (it used to stop at once): in-flight requests finish, and the leader lock and database connections are released.

### Security
- **A risk-triggered step-up stepped up every user of the client.** Continuous verification enforced a risky session's step-up by raising the `requiredAcr` of its whole client, permanently. It now applies to that user only: the authorization endpoint requires the risk's ACR (MFA, or WebAuthn at critical risk) of a user with a flagged session, until the flag expires. The trigger also recorded the required ACR as already *satisfied* for the session, and it announced the same step-up (risk event and WebSocket push) every minute until it expired; each risk episode is now announced once.
- **Registration, email verification and magic links had no rate limit at all.** They were exempt from the global throttle and had no realm limit, so anyone could create accounts or have any address flooded with verification or sign-in mail. They now fall under the global throttle and the realm's IP limit. A verification resend or a password reset sends at most one email a minute per account, with the same response either way.
- **Concurrent failed sign-ins went uncounted.** The brute-force counter runs Serializable, and PostgreSQL aborts one of two conflicting transactions; that failure was rolled back and never counted, so a parallel password-guessing burst got many more tries than `maxLoginFailures`. Aborted transactions are now retried, and the lockout email is sent once, after the lockout has committed.
- **One refresh token could be redeemed several times at once.** Concurrent refreshes with the same token each checked it was live, then each revoked it and got new tokens: several token families from one. The revocation is now the claim, conditional on the token still being live; a request that loses is treated as reuse, and the session's refresh tokens are revoked (RFC 9700).
- **A refresh could widen the scope.** A `scope` broader than the token was granted was issued as asked. It is now refused with `invalid_scope` (RFC 6749 §6); a narrower scope still works.
- **A disabled user could keep refreshing tokens.** The refresh grant now refuses them.
- **A TOTP code could be accepted more than once.** Submissions of the same code checked that it was unused before any of them recorded it, so concurrent ones (on one instance or several) all passed. The code is now claimed by inserting it under a new unique index on (user, code), and only the first insert wins; an earlier use whose window has passed is taken over, so a code that comes round again still works.

### Changed
- **Only failed requests get an access-log line by default** (`LOG_ACCESS=errors`): 4xx at `warn`, 5xx at `error`. A line for every request cost throughput on the busiest endpoints. `LOG_ACCESS=all` logs every request as before, and `off` none; application logs are unaffected.
- **Client-credentials tokens, introspection and userinfo no longer query the database per request.** What a token says about its user (profile, roles direct and through groups, custom-attribute claims), the realm's scope mappers, the revoked token ids and whether a session still exists are cached in every process. New triggers announce every change to them, as for realms and clients, so a disabled user, a changed role, a revoked token or an ended session is seen by the next request.
- Each signing key is parsed once instead of on every token signed or verified.
- The protocol endpoints (token, introspection, discovery, JWKS, userinfo) are matched before the admin routes.
- The global throttler counts hits per second, so a request costs the same however many the client has made. (The library's storage filtered every hit in the window on each request.)
- Checking for pending migrations (at startup, on the admin version endpoint and in the upgrade checks) no longer blocks the server while the Prisma CLI runs.
- The Docker image no longer ships npm's and Prisma's download caches, source maps, TypeScript, or Prisma's query compilers for other databases.

- **Realms, clients, signing keys and CORS origins are cached in every process**, with no Redis needed. Discovery, JWKS and every realm-scoped request no longer query the database each time. The database itself keeps the copies current: triggers on `realms`, `clients` and `realm_signing_keys` announce each change with PostgreSQL `NOTIFY`, and every process and replica drops what changed as soon as it hears it, however the change was made. While that connection is down a process reads from the database, and it starts empty once reconnected. Set `CACHE_L1=off` behind a connection pooler in transaction mode. With Redis, the same announcements delete the shared entries.
- The realm rate-limit settings are read from the realm cache instead of one query per check.
- In-process cache hits no longer copy the cached object: a value is copied once on its way in and deeply frozen, then shared by every reader. Copying it on every read was the largest single cost left on cached requests.
- **Token, introspection, revocation and token-verification requests no longer read the client and the realm's signing key from the database each time.** Both are cached in-process only (never in Redis: they hold the client's secret hash and the private key) and dropped as soon as the database announces a change, so a disabled client or a new signing key takes effect on the next request. All 17 places that looked up the active signing key now share one lookup, which also picks the newest active key everywhere (some picked any active key).
- **The Docker image is about 620 MB smaller on disk** (447 MB to 317 MB to download). A final `chown -R /app` copied all of `node_modules` into a second layer only to change its owner. The app code and `node_modules` now stay owned by root, so a compromised process cannot rewrite them; the `node` user owns only what the server writes: `/app` itself, `uploads`, `backups` and `themes`.

### Fixed
- **The Helm chart could not start Idenplane with its defaults.** The image tag defaults to the chart's `appVersion`. That was `0.0.1`, which was never published, so a default install could not pull its image. `appVersion` is now `0.6.0` (chart `0.2.0`). The release check now refuses a tag that does not match `appVersion`, so the two can no longer drift apart.
- **The database rate limiter (without Redis) could let a client past its limit at every window boundary.** Concurrent requests could each restart an expired window and wipe the others' counts. Counting and restarting a window is now one atomic statement.
- **Theme asset upload never worked.** `POST /admin/realms/{realm}/themes/assets/upload` rejected every file (`property data should not exist`): the nested DTO was never transformed, so validation stripped its fields. Had it accepted one, the returned URL (`/themes/assets/...`) was served by nothing. Uploads are now accepted and served from `/themes/uploads/{realmId}/{file}`, with a sandboxing Content-Security-Policy and `nosniff` so an uploaded SVG cannot run script, and long-lived caching; a name's own extension is no longer doubled (`logo.png.png`).
- **Disabling or uninstalling a plugin took effect only on the instance that handled the request.** The others kept running it, token enrichment and event listeners included, until they restarted. Every instance now follows the change at once (PostgreSQL `NOTIFY`), runs its own `onEnable`/`onDisable`, and rereads all plugin states after any gap in that channel; `onUninstall` still runs once.
- **Instances booting together on an empty database crashed, and could leave the master realm without an admin for good.** First-boot seeding is now one transaction behind a PostgreSQL advisory lock: one instance seeds, the others find it done. A seed interrupted halfway can no longer leave a realm that every later boot takes for complete. The setup wizard's state and a plugin's first install are likewise created once when requests or instances race; an instance that loses the plugin race used to run without the plugin.
- **NHI credential policies with `autoRotate: true` did nothing:** their scheduler was never registered. It now runs, on the elected instance. When a credential reaches its rotation threshold it is flagged `rotationRequired` and an `nhi.credential.rotation_due` webhook is sent, once; the owner rotates it through the API, which returns the new key. The unregistered code would have revoked the working key and stored a replacement nobody could learn.
- **Scheduled jobs ran once per instance, and two of them twice per instance.** Risk re-evaluation, step-up and termination checks, trust decay and NHI credential rotation now run on one elected instance (a PostgreSQL advisory lock; another instance takes over within about 15 s). That ends duplicate termination emails and audit rows, N-fold trust decay, and duplicate credential rotations. The step-up and termination checks also carried a second `@Interval` of their own, which is removed. Live session events reach a client on whichever instance holds its WebSocket. `LEADER_ELECTION=off` restores the old behaviour.
- **Webhooks were delivered once per instance.** Every instance (Helm runs 3 by default) drained the same outbox batch and sent each event. An event is now claimed with a conditional update on the state it was read in, so only one instance delivers it. An event left PROCESSING by an instance that died mid-delivery is now taken over after a 5-minute lease; it used to stay stuck forever.
- **Concurrent sign-ins for the same user could fail with a 500.** Once the user was at the realm's session cap (`maxSessionsPerUser`, 10 by default), a sign-in could evict another sign-in's session in the moment between its creation and its refresh token's, which then failed on a foreign key. A new session and its refresh token are now one write, and the cap is applied afterwards, to older sessions only, so concurrent sign-ins all succeed and the newest sessions are kept. A refresh or code exchange whose session has meanwhile ended answers `invalid_grant` instead of a 500. Evicting older sessions at the cap is one statement and can no longer fail a sign-in: concurrent evictions could deadlock, and the loser's sign-in got a 500.
- The default Argon2 concurrency and database pool size now follow the CPUs the process may use (its cpuset), not every core of the host, which oversized both in pinned containers.
- **CORS denied every client origin from five minutes after boot.** The allowed-origin set expired and nothing reloaded it; the same happened right after any client edit. It is now reloaded on every client change and never expires to empty.
- **Changes that bypassed cache invalidation were served stale with Redis.** These were:
  - assigning a login flow to a client;
  - a risk-triggered raise of a client's required ACR;
  - overwriting a realm on import;
  - a client looked up by its database id.

  They are now invalidated by the database, along with every other write.
- With several instances, a CORS change reached only the instance that made it until the others' 5-minute cache expired. It now reaches all of them at once.

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

[Unreleased]: https://github.com/idenplane/idenplane/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/idenplane/idenplane/releases/tag/v0.7.0
[0.6.0]: https://github.com/idenplane/idenplane/releases/tag/v0.6.0
[0.5.0]: https://github.com/idenplane/idenplane/releases/tag/v0.5.0
[0.4.0]: https://github.com/idenplane/idenplane/releases/tag/v0.4.0
[0.3.0]: https://github.com/idenplane/idenplane/releases/tag/v0.3.0
[0.2.0]: https://github.com/idenplane/idenplane/releases/tag/v0.2.0
[0.1.0]: https://github.com/idenplane/idenplane/releases/tag/v0.1.0
