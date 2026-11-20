---
id: versioning-and-support
title: Versioning and Support
description: How Idenplane numbers its releases before 1.0, which versions receive security fixes, how features are deprecated, and which versions of PostgreSQL, Node.js, Redis, Kubernetes and the SDKs each release was tested with.
---

# Versioning and Support

Idenplane has one maintainer. This page describes what that maintainer actually does with releases, not an aspiration. Where something is not tested, the page says so.

## Version numbers

### The server: SemVer before 1.0

The server is at `0.MINOR.PATCH`. [Semantic Versioning](https://semver.org/spec/v2.0.0.html) allows anything to change before 1.0. Idenplane applies it like this:

- **A minor release** (0.8.0 → 0.9.0) can add features, change behaviour, add database migrations and remove things. When you need to do something before or after upgrading, the release's entry in the [CHANGELOG](https://github.com/idenplane/idenplane/blob/main/CHANGELOG.md) has a **Before you upgrade** section. Read it before you upgrade, every time.
- **A patch release** (0.9.0 → 0.9.1) is for fixes. It does not add features. A security fix can still change the behaviour that *was* the vulnerability. 0.8.1, for example, made the setup wizard require an admin login and stopped defaulting `ADMIN_PASSWORD` to `admin`. When a patch changes behaviour like that, it has a **Before you upgrade** section too.
- Every release entry says whether you need to do anything. Look for a line such as "No configuration or upgrade steps are needed when coming from 0.9.0."
- Some upgrades cannot be rolling. 0.8.0 encrypted stored secrets that older versions cannot read, so the old version had to be stopped first. The CHANGELOG says so when this is the case.

If you skip versions, read the **Before you upgrade** notes of every release in between, not just the one you are moving to. Database migrations are applied in order on start, but the manual steps are yours.

What will change at 1.0 has not been decided. There is no date for it.

### SDKs and other packages

The SDKs and tools are released separately from the server, each from its own git tag (see [Releasing](/contributing/releasing)). Most are past 1.0, for example `idenplane-sdk` 1.2.0 and `idenplane-java-core` 1.1.0. They follow ordinary SemVer: a patch fixes bugs, a minor adds API or moves a dependency that consumers inherit, and a major breaks consumers of that package.

The SDKs speak standard OAuth 2.0 and OpenID Connect to the server. They are not tied to a server version.

### The Helm chart

The chart in `helm/idenplane` has its own SemVer `version`. Its `appVersion` is the server version it deploys by default. The release check (`release-version-check.yml`) refuses a server tag unless `package.json`, the chart's `appVersion` and the CHANGELOG agree.

## Which versions get security fixes

| Version | Security fixes |
|---|---|
| The latest release (today 0.14.1) | Yes |
| Every earlier release, including earlier patches of the same minor | No. Upgrade to the latest release. |

Fixes are released as a new version cut from `main`. There are no maintenance branches and no backports to older minors. With one maintainer and minor releases that have come days or weeks apart, a support window for older lines is not something the project can honestly offer yet. If that changes, this page will say so before it applies.

The latest release of each SDK gets fixes. Earlier SDK versions do not.

When a release fixes a vulnerability:

- its CHANGELOG entry has a **Security** section;
- a [GitHub Security Advisory](https://github.com/idenplane/idenplane/security/advisories) names the affected and the fixed versions;
- the release summary says how urgent the upgrade is.

To report a vulnerability, see [`SECURITY.md`](https://github.com/idenplane/idenplane/blob/main/SECURITY.md).

## Deprecation

### How a feature is deprecated

1. The CHANGELOG entry of the release that deprecates it says so, and the docs page for the feature carries a deprecation note naming what to use instead.
2. A deprecated feature keeps working for at least one more minor release. It is removed in a minor release, never in a patch, and the removal is listed under **Removed** and in **Before you upgrade**.
3. The exception is a feature that cannot be kept without leaving users exposed. Such a feature can change or go in the release that fixes the vulnerability, as the anonymous setup wizard did in 0.8.1.

Deprecated today, with no removal release set:

- the OAuth 2.0 password grant (deprecated by OAuth 2.1; see [Authentication](/guides/authentication));
- the implicit flow setting on clients;
- `isDefault` on authentication flows, which is informational only (see [Custom Auth Flows](/guides/auth-flows)).

### `Deprecation` and `Sunset` headers on the admin API

`DeprecationInterceptor` (`src/versioning/deprecation.interceptor.ts`) adds two headers to successful responses for an unversioned admin path, meaning any path under `/admin` that does not start with `/api/v`. Requests refused by authentication or authorization, and requests that end in an error, don't get them:

```http
Deprecation: Tue, 01 Jan 2027 00:00:00 GMT
Sunset: Sat, 01 Jan 2028 00:00:00 GMT
```

The `Sunset` header follows RFC 8594. The `Deprecation` value is an HTTP date.

**No admin route is served under `/api/v1`.** URI versioning is turned on in `main.ts`, but no controller declares a version. Up to 0.9.1 a third header, `Link: </api/v1/admin/...>; rel="successor-version"`, pointed at that path and got a `404`; 0.10.0 stops sending it until a versioned admin API ships. The unversioned `/admin/...` paths are the admin API. Keep using them, and don't move scripts to `/api/v1`.

The unversioned admin paths will not be removed before both of these are true:

- a versioned admin API has shipped in a release;
- the date in the `Sunset` header has passed.

If the versioned API is not ready in time, the `Sunset` date will move later, and the CHANGELOG will say so.

## Compatibility matrix

Each value below comes from the release's tag in the repository or from its CI run. "Tested" means a CI job ran it. Anything else is marked.

| Server | Helm chart | `idenplane-sdk` tested in CI | Node.js | PostgreSQL | Redis | Kubernetes (CI) |
|---|---|---|---|---|---|---|
| 0.14.1 | 0.10.1 | 2.0.1 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.14.0 | 0.10.0 | 2.0.1 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.13.1 | 0.9.1 | 2.0.1 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.13.0 | 0.9.0 | 2.0.0 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.12.0 | 0.8.0 | 2.0.0 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.11.1 | 0.7.1 | 2.0.0 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.11.0 | 0.7.0 | 2.0.0 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.10.1 | 0.6.1 | 1.2.0 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.10.0 | 0.6.0 | 1.2.0 | 24 | 16 tested, 17 in the chart; image has 16, 17 and 18 clients | 7, not tested at runtime | 1.37.0 (kind) |
| 0.9.1 | 0.5.1 | 1.2.0 | 24 | 16 tested, 17 in the chart | 7, not tested at runtime | 1.35.0 (kind) |
| 0.9.0 | 0.5.0 | 1.2.0 | 24 | 16 tested, 17 in the chart | 7, not tested at runtime | 1.35.0 (kind) |
| 0.8.1 | 0.4.1 | 1.2.0 | 24 | 16 tested, 17 in the chart | 7, not tested at runtime | 1.35.0 (kind) |
| 0.8.0 | 0.4.0 | 1.2.0 | 24 | 16 tested, 17 in the chart | 7, not tested at runtime | 1.35.0 (kind) |

Where each column comes from:

- **Helm chart:** `version` in `helm/idenplane/Chart.yaml` at the release tag.
- **`idenplane-sdk`:** the version in `packages/idenplane-js/package.json` at the tag. CI's *SDK Integration Tests* job runs that SDK, built from the same commit, against the server built from the same commit. Other SDKs (Go, the MCP server) are tested the same way. The rest have unit tests only.
- **Node.js:** the Docker image is built `FROM node:24-alpine`, and every CI job uses Node 24. The server's `package.json` has no `engines` field. Node 22 is not tested, though the admin console declares `node >= 22.22.0` for its build. Use 24.
- **PostgreSQL:** CI and the compose files use `postgres:16-alpine`. The *Helm install (kind)* job installs the chart with its bundled database, which is `postgres:17-bookworm`, so 17 is exercised there. PostgreSQL 16 or later is required. 15 and earlier are not supported, and neither is any other database.
- **Redis:** the compose files and the chart use `redis:7-alpine`. Redis is optional. CI only renders the chart with Redis on and does not run the server against Redis.
- **Kubernetes:** the *Helm install (kind)* job uses whatever node image the `helm/kind-action` default provides. The version is not pinned. In the runs for 0.8.0, 0.8.1, 0.9.0 and 0.9.1 it was kind v0.31.0 with `kindest/node:v1.35.0`; for 0.10.0, kind v0.33.0 with `kindest/node:v1.37.0`. The chart sets no `kubeVersion`. No other Kubernetes version is tested.

:::note PostgreSQL client in the image
From 0.10.0 the image ships the PostgreSQL **16, 17 and 18** clients side by side (`ARG PG_CLIENT_MAJORS` in the `Dockerfile`). The built-in [upgrade API](/deployment/upgrading) reads the server's major version and uses the matching `pg_dump` and `pg_restore`, so it works with the compose files' PostgreSQL 16 and the chart's bundled PostgreSQL 17 alike. It still refuses to run when no matching client is installed. Up to 0.9.1 the image had only the 16 client.
:::
