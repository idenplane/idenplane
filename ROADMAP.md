# Roadmap

This roadmap lists work that is planned or being considered. It is not a schedule. Idenplane has one maintainer, so nothing here has a date, and items can move, change or be dropped. What has shipped is in the [CHANGELOG](CHANGELOG.md).

- **Planned:** the maintainer intends to do it, usually in the release named.
- **Under consideration:** worth doing, but not committed. It may depend on demand, funding or time.

To suggest or discuss an item, use [GitHub Discussions, Ideas](https://github.com/idenplane/idenplane/discussions/categories/ideas).

## Next: 0.10.0

All planned.

### Security hardening

Another pass over the server's security, following the advisories fixed in 0.8.1 and 0.9.0. Details will be in the 0.10.0 CHANGELOG. Vulnerabilities themselves are handled privately, as described in [`SECURITY.md`](SECURITY.md).

### Threat model

A written threat model at [`docs/docs/security/threat-model.md`](docs/docs/security/threat-model.md): what Idenplane protects, against whom, and what it assumes about the deployment.

### Supply-chain signing and SBOM

Today the Docker image is pushed to Docker Hub without a signature, an SBOM or a provenance attestation. The plan:

- sign the release images;
- publish an SBOM for each image;
- attach build provenance;
- document how to verify all three before you deploy.

### Scheduled conformance testing

Run the OpenID Foundation conformance suite (the OIDC basic plan) against the current code on a schedule, not only by hand before a release, so a regression shows up as a failed run. This is testing only. Idenplane is not OpenID Certified.

### Backup and restore drill

The [Production Checklist](docs/docs/deployment/production.md) asks operators to restore their latest backup into a fresh database every quarter, then start Idenplane against it and sign in. The plan is to run that same drill in CI on a schedule: back up, restore into an empty database, start the server with the same keys, sign in. That way the documented procedure is known to work.

## Later

### Independent security audit (under consideration, seeking funding)

An external audit of the server by an independent security firm. A good audit costs more than a single-maintainer project can pay, so this depends on funding. Grant programmes for open-source security are the most likely source. Until an audit has happened, Idenplane makes no claim to have been audited.

### Versioned admin API (under consideration)

Unversioned `/admin/...` responses already carry `Deprecation` and `Sunset` headers that point to `/api/v1/admin/...`, but no route is served there yet. Either the versioned admin API ships, or the headers are changed to match what is served. See [Versioning and Support](docs/docs/project/versioning-and-support.md#deprecation-and-sunset-headers-on-the-admin-api).

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
