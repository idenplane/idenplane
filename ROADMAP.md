# Roadmap

This roadmap lists work that is planned or being considered. It is not a schedule. Idenplane has one maintainer, so nothing here has a date, and items can move, change or be dropped. What has shipped is in the [CHANGELOG](CHANGELOG.md).

- **Planned:** the maintainer intends to do it, usually in the release named.
- **Under consideration:** worth doing, but not committed. It may depend on demand, funding or time.

To suggest or discuss an item, use [GitHub Discussions, Ideas](https://github.com/idenplane/idenplane/discussions/categories/ideas).

## Shipped from earlier roadmaps

Everything planned for 0.10.0 shipped in [0.10.0](CHANGELOG.md#0100---2026-11-16):

- **Security hardening:** new realms are secure by default (brute-force protection and audit events on), with an OWASP ASVS 5.0 Level 2 self-assessment.
- **Threat model:** [`docs/docs/security/threat-model.md`](docs/docs/security/threat-model.md).
- **Supply-chain signing and SBOM:** every published image carries a keyless cosign signature, a signed SPDX SBOM and SLSA provenance; [Verify releases](docs/docs/security/verify-releases.md) shows how to check all three.
- **Scheduled conformance testing:** the OpenID Foundation conformance suite (basic and config plans) runs in CI on a schedule (`conformance.yml`).
- **Backup and restore drill:** CI runs the full drill and an upgrade from the previous release on a schedule (`restore-drill.yml`).

Releases since then (0.10.1 to 0.14.1) are in the [CHANGELOG](CHANGELOG.md).

## Next

No feature release is planned right now; releases continue with fixes and dependency updates. The next planned work will be picked from the items below.

## Later

### Independent security audit (under consideration, seeking funding)

An external audit of the server by an independent security firm. A good audit costs more than a single-maintainer project can pay, so this depends on funding. Grant programmes for open-source security are the most likely source. Until an audit has happened, Idenplane makes no claim to have been audited.

### Versioned admin API (under consideration)

Unversioned `/admin/...` responses carry `Deprecation` and `Sunset` headers, but no versioned route (`/api/v1/admin/...`) is served yet. Either the versioned admin API ships, or the headers are changed to match what is served. See [Versioning and Support](docs/docs/project/versioning-and-support.md#deprecation-and-sunset-headers-on-the-admin-api).

### Certificate revocation checks for mTLS (under consideration)

mTLS client authentication checks revoked certificates against a per-realm deny-list. Checking CRLs and OCSP is not implemented.

### Admin self-service password change (under consideration)

An endpoint for an admin to change their own password. It does not exist today.

### Removing the OAuth 2.0 password grant (under consideration)

The password grant is deprecated, following OAuth 2.1. Removing it would follow the [deprecation policy](docs/docs/project/versioning-and-support.md#deprecation): announced in advance, and done in a minor release.

### Wider test matrix (under consideration)

CI does not yet run the server against Redis, and it tests the Helm chart on a single Kubernetes version. Both gaps are listed in the [compatibility matrix](docs/docs/project/versioning-and-support.md#compatibility-matrix).

### Another database (under consideration, only on demand)

PostgreSQL 16+ is the only supported database (see [`DECISIONS.md`](DECISIONS.md), 2026-11-13). MySQL could be considered if users need it. Every extra database multiplies the security-critical code and the test matrix, so this will not happen without real demand.

### 1.0 (under consideration)

What 1.0 should guarantee, such as API stability and a support window for older releases, has not been decided. There is no date.

### More maintainers

The project would be healthier with more than one maintainer. [`GOVERNANCE.md`](GOVERNANCE.md) describes how someone becomes one.
