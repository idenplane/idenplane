# OpenSSF Best Practices badge: answer sheet (passing level)

This file is for filling in the questionnaire at <https://www.bestpractices.dev/en/projects/new>. The form needs a maintainer's GitHub login, so a maintainer has to submit it. Copy each answer and its evidence link into the form.

- **Project URL:** `https://github.com/idenplane/idenplane`
- **Home page:** `https://idenplane.com`
- **Evidence links:** links to files point at `dev`, the default branch.
- **Items marked "Maintainer to confirm":** they depend on facts that only the maintainer can state, such as response times. Check each one before you answer.

After the badge is granted, add it to the README next to the Scorecard badge:

```html
<a href="https://www.bestpractices.dev/projects/<ID>"><img src="https://www.bestpractices.dev/projects/<ID>/badge" alt="OpenSSF Best Practices" /></a>
```

Abbreviations: **M** = Met, **N/A** = not applicable, **SUGGESTED** = the criterion is a suggestion at this level.

---

## Basics

| Criterion | Answer | Justification and evidence |
|---|---|---|
| `description_good` | M | The README says what the software does: an open-source IAM server (OAuth 2.0, OIDC, SAML 2.0, MFA). [README.md](https://github.com/idenplane/idenplane/blob/dev/README.md) |
| `interact` | M | The README links the docs, issues and releases. Issues use templates. [README.md](https://github.com/idenplane/idenplane/blob/dev/README.md), [issue templates](https://github.com/idenplane/idenplane/tree/dev/.github/ISSUE_TEMPLATE) |
| `contribution` | M | The contribution process is in [CONTRIBUTING.md](https://github.com/idenplane/idenplane/blob/dev/CONTRIBUTING.md): fork, branch naming, commits, pull requests, review. |
| `contribution_requirements` | M | Code standards, testing and security requirements are in [CONTRIBUTING.md § Code Standards](https://github.com/idenplane/idenplane/blob/dev/CONTRIBUTING.md#code-standards). There is also a [PR template](https://github.com/idenplane/idenplane/blob/dev/.github/pull_request_template.md). |
| `floss_license` | M | AGPL-3.0-only. [LICENSE](https://github.com/idenplane/idenplane/blob/dev/LICENSE) |
| `floss_license_osi` | M | AGPL-3.0 is OSI-approved. |
| `license_location` | M | [LICENSE](https://github.com/idenplane/idenplane/blob/dev/LICENSE) is in the repository root. |
| `documentation_basics` | M | Install, configure, deploy and upgrade guides: <https://idenplane.com/docs>. The sources are in [docs/docs](https://github.com/idenplane/idenplane/tree/dev/docs/docs). |
| `documentation_interface` | M | An API reference ([docs/docs/api](https://github.com/idenplane/idenplane/tree/dev/docs/docs/api)) and the OpenAPI document every instance serves at `/api-json`, with Swagger UI at `/api`. |
| `sites_https` | M | The project site, the repository, downloads (GitHub releases, Docker Hub, npm) and the docs all use HTTPS. |
| `discussion` | M | GitHub issues and pull requests are public, searchable and linkable. |
| `english` | M | All documentation, issues and code are in English. |
| `maintained` | M | Active: releases 0.7.0 to 0.9.1 shipped in November 2026. [Releases](https://github.com/idenplane/idenplane/releases) |

## Change control

| Criterion | Answer | Justification and evidence |
|---|---|---|
| `repo_public` | M | <https://github.com/idenplane/idenplane> |
| `repo_track` | M | Git: every change has an author, a timestamp and a message. |
| `repo_interim` | M | Work lands on `dev` between releases. `main` holds released code. |
| `repo_distributed` | M | Git. |
| `version_unique` | M | Every release has a unique `vX.Y.Z` tag. [Tags](https://github.com/idenplane/idenplane/tags) |
| `version_semver` (SUGGESTED) | M | Semantic versioning. [Releasing guide](https://github.com/idenplane/idenplane/blob/dev/docs/docs/contributing/releasing.mdx) |
| `version_tags` (SUGGESTED) | M | Annotated `v*` tags. `release-version-check.yml` refuses a tag that disagrees with `package.json`, the Helm chart or CHANGELOG. [release-version-check.yml](https://github.com/idenplane/idenplane/blob/dev/.github/workflows/release-version-check.yml) |
| `release_notes` | M | Human-readable notes for every release in [CHANGELOG.md](https://github.com/idenplane/idenplane/blob/dev/CHANGELOG.md) and on the GitHub releases. |
| `release_notes_vulns` | M | The notes name every fixed vulnerability by advisory ID, for example GHSA-424c-q96v-g3q7 (0.9.0) and GHSA-cxj4-xh78-x373 (0.8.1). [CHANGELOG.md](https://github.com/idenplane/idenplane/blob/dev/CHANGELOG.md) |

## Reporting

| Criterion | Answer | Justification and evidence |
|---|---|---|
| `report_process` | M | Bugs go to GitHub issues, with a [bug report template](https://github.com/idenplane/idenplane/blob/dev/.github/ISSUE_TEMPLATE/bug_report.yml). |
| `report_tracker` (SUGGESTED) | M | GitHub issues. |
| `report_responses` | M. **Maintainer to confirm.** | The majority of bug reports from the last 2 to 12 months were acknowledged. Check the [closed issues](https://github.com/idenplane/idenplane/issues?q=is%3Aissue+is%3Aclosed). |
| `enhancement_responses` | M. **Maintainer to confirm.** | The majority of enhancement requests from the last 2 to 12 months got a response. |
| `report_archive` | M | Issues and pull requests are public and searchable on GitHub. |
| `vulnerability_report_process` | M | [SECURITY.md](https://github.com/idenplane/idenplane/blob/dev/SECURITY.md) |
| `vulnerability_report_private` | M | Reports go to security@idenplane.com or a private GitHub Security Advisory. [SECURITY.md](https://github.com/idenplane/idenplane/blob/dev/SECURITY.md) |
| `vulnerability_report_response` | M. **Maintainer to confirm.** | SECURITY.md promises a first response within 48 hours, and the criterion requires 14 days or less. For example, GHSA-2463-97f9-hw7j and GHSA-jfx3-gv42-6qwv (reported by EQSTLab) were fixed in 0.8.1. |

## Quality

| Criterion | Answer | Justification and evidence |
|---|---|---|
| `build` | M | `npm ci && npm run build`, or `docker build .`. [Dockerfile](https://github.com/idenplane/idenplane/blob/dev/Dockerfile), [development setup](https://github.com/idenplane/idenplane/blob/dev/docs/docs/contributing/development-setup.mdx) |
| `build_common_tools` | M | npm, the TypeScript compiler (Nest CLI), Docker. |
| `build_floss_tools` | M | Every build tool is FLOSS. |
| `test` | M | Jest unit tests (`src/**/*.spec.ts`) and end-to-end suites against PostgreSQL (`test/*.e2e-spec.ts`), plus SDK, admin UI, Helm and example suites. |
| `test_invocation` (SUGGESTED) | M | `npm test` and `npm run test:e2e`. [package.json](https://github.com/idenplane/idenplane/blob/dev/package.json) |
| `test_most` (SUGGESTED) | M | The unit suite runs with coverage in CI (the `coverage-report` artifact of `ci.yml`), and roughly 800 e2e tests cover the protocol flows. |
| `test_continuous_integration` (SUGGESTED) | M | Every PR and every push to `dev`/`main` runs CI. [ci.yml](https://github.com/idenplane/idenplane/blob/dev/.github/workflows/ci.yml) |
| `test_policy` | M | New functionality needs tests: [CONTRIBUTING.md § Testing](https://github.com/idenplane/idenplane/blob/dev/CONTRIBUTING.md#testing) and the PR template. |
| `tests_are_added` | M. **Maintainer to confirm.** | Recent feature PRs add tests. For example, the admin RBAC release added `test/admin-rbac.e2e-spec.ts`, and the DAST fixes added `test/dast-regressions.e2e-spec.ts`. |
| `tests_documented_added` (SUGGESTED) | M | [PR template](https://github.com/idenplane/idenplane/blob/dev/.github/pull_request_template.md), [CONTRIBUTING.md](https://github.com/idenplane/idenplane/blob/dev/CONTRIBUTING.md) |
| `warnings` | M | ESLint (typescript-eslint, prettier) and the TypeScript compiler run in CI, and any error fails the build. `lint:cycles` fails on import cycles. [eslint.config.mjs](https://github.com/idenplane/idenplane/blob/dev/eslint.config.mjs) |
| `warnings_fixed` | M | CI is green on `dev`, and the lint job fails on findings. |
| `warnings_strict` (SUGGESTED) | M | `strictNullChecks` and the strict ESLint rule set. Full TypeScript `strict` is not enabled, and [tsconfig.json](https://github.com/idenplane/idenplane/blob/dev/tsconfig.json) explains why. |

## Security

| Criterion | Answer | Justification and evidence |
|---|---|---|
| `know_secure_design` | M. **Maintainer to confirm.** | The secure-design decisions are recorded in [DECISIONS.md](https://github.com/idenplane/idenplane/blob/dev/DECISIONS.md) and the ADRs in [docs/docs/contributing/adrs.mdx](https://github.com/idenplane/idenplane/blob/dev/docs/docs/contributing/adrs.mdx). |
| `know_common_errors` | M. **Maintainer to confirm.** | The code addresses the OWASP Top 10 classes: CSRF tokens on hosted forms, nonce-based CSP, SSRF-safe webhook URLs (`src/common/security`), rate limiting and brute-force lockout. It is also checked by CodeQL and OWASP ZAP. |
| `crypto_published` | M | Only published algorithms: RS256/ES256 JWT signatures (`jose`), AES-256-GCM for secrets at rest, argon2id for passwords, HMAC for TOTP (RFC 6238). |
| `crypto_call` | M | No primitives are implemented in the project. It uses Node's `crypto`, `jose`, `argon2` and `xml-crypto`. [src/crypto](https://github.com/idenplane/idenplane/tree/dev/src/crypto) |
| `crypto_floss` | M | Every cryptographic library is FLOSS. |
| `crypto_keylength` | M | RSA signing keys are 2048 bits or more, encryption keys are AES-256 (scrypt-derived), and P-256 or stronger for EC. |
| `crypto_working` | M | No broken algorithms are used for security. SHA-1 appears only as the HMAC in TOTP, as RFC 6238 and authenticator apps require (HMAC-SHA1 is not affected by SHA-1 collisions). |
| `crypto_weaknesses` (SUGGESTED) | M | Same as above. |
| `crypto_pfs` (SUGGESTED) | N/A | TLS is terminated by the deployer's reverse proxy or ingress. The [production checklist](https://github.com/idenplane/idenplane/blob/dev/docs/docs/deployment/production.md) requires HTTPS. |
| `crypto_password_storage` | M | User passwords are hashed with argon2id. bcrypt hashes imported from other IdPs are verified and re-hashed to argon2id on login. [crypto.service.ts](https://github.com/idenplane/idenplane/blob/dev/src/crypto/crypto.service.ts), [password-migration.service.ts](https://github.com/idenplane/idenplane/blob/dev/src/migration/password-migration.service.ts) |
| `crypto_random` | M | `crypto.randomBytes` / `randomUUID` for every token, secret, nonce and key. |
| `delivery_mitm` | M | Releases are delivered over HTTPS (GitHub, Docker Hub, npm). From 0.10.0 every image is cosign-signed (keyless, logged in Rekor), with an SBOM and SLSA provenance. [Verifying releases](https://github.com/idenplane/idenplane/blob/dev/docs/docs/security/verify-releases.md) |
| `delivery_unsigned` | M | No hash is fetched over HTTP. Release checksums (`SHA256SUMS`) are themselves cosign-signed. |
| `vulnerabilities_fixed_60_days` | M. **Maintainer to confirm.** | Every published advisory was fixed in a release within days. Check that no medium-or-higher vulnerability has been public and unfixed for more than 60 days, under [Security → Advisories](https://github.com/idenplane/idenplane/security/advisories) and Dependabot alerts. |
| `vulnerabilities_critical_fixed` (SUGGESTED) | M. **Maintainer to confirm.** | As above. |
| `no_leaked_credentials` | M | The PR hygiene workflow scans every diff for secrets ([pr-hygiene.yml](https://github.com/idenplane/idenplane/blob/dev/.github/workflows/pr-hygiene.yml)), and test values are marked `dummy`/`example`. Enable GitHub secret scanning and push protection in the repository settings if they are not on already. |

## Analysis

| Criterion | Answer | Justification and evidence |
|---|---|---|
| `static_analysis` | M | CodeQL default setup (JavaScript/TypeScript, Go, Python, Actions) runs on every PR and weekly, and ESLint runs on every PR. The OpenSSF Scorecard runs weekly. [scorecard.yml](https://github.com/idenplane/idenplane/blob/dev/.github/workflows/scorecard.yml) |
| `static_analysis_common_vulnerabilities` (SUGGESTED) | M | CodeQL's security queries (injection, XSS, SSRF, path traversal, ...). |
| `static_analysis_fixed` | M. **Maintainer to confirm.** | No open medium-or-higher CodeQL alerts. Check the code scanning tab. |
| `static_analysis_often` (SUGGESTED) | M | Every PR. |
| `dynamic_analysis` (SUGGESTED) | M | OWASP ZAP baseline and API scans run weekly, on releases and on PRs that change `src/**` ([dast-zap.yml](https://github.com/idenplane/idenplane/blob/dev/.github/workflows/dast-zap.yml)). The OpenID Foundation conformance suite runs weekly ([conformance.yml](https://github.com/idenplane/idenplane/blob/dev/.github/workflows/conformance.yml)), and so do a backup/restore drill and an upgrade test ([restore-drill.yml](https://github.com/idenplane/idenplane/blob/dev/.github/workflows/restore-drill.yml)). |
| `dynamic_analysis_unsafe` (SUGGESTED) | N/A | TypeScript on Node.js is memory-safe, and the project ships no C/C++. |
| `dynamic_analysis_enable_assertions` (SUGGESTED) | M | The e2e suites run the full application with `NODE_ENV=test` and assert on behaviour, and the ZAP gate fails on any unaccepted alert. |
| `dynamic_analysis_fixed` | M | Every real finding of the first ZAP scan was fixed: crashes on malformed input, missing headers, cacheable personal pages. The remaining accepted alerts are listed with reasons in [.zap/rules.tsv](https://github.com/idenplane/idenplane/blob/dev/.zap/rules.tsv). |

---

## Repository settings the maintainer should check (Scorecard reads them too)

These are settings, not files, so this change does not make them:

- **Branch protection** on `dev` and `main`:
  - require a pull request with at least one approving review;
  - require the CI status checks;
  - dismiss stale approvals;
  - no force-push, no deletion.

  Scorecard's Branch-Protection and Code-Review checks score these. For Branch-Protection to be read at all, add a fine-grained token with read access to administration as the `repo_token` of the Scorecard action. Without it, the check reports what it can see without admin access.
- **Secret scanning and push protection** (Settings → Code security).
- **Private vulnerability reporting** (Settings → Code security), so the advisory link in SECURITY.md works for reporters.
- **Default workflow permissions** read-only (Settings → Actions → General). Every workflow already declares its own `permissions:`.
