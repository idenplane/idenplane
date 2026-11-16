# Governance

This document describes how Idenplane is run today. It will change if the project gains more maintainers.

## Model

Idenplane has a single maintainer, [@Islamawad132](https://github.com/Islamawad132), who has the final say on every technical and project decision. This is often called a "benevolent dictator" model. It is a consequence of the project's size, not a goal. The aim is to add maintainers when there are contributors who want the role.

The maintainer:

- reviews and merges pull requests;
- decides what goes into each release, and cuts releases;
- triages issues and security reports;
- owns the repository settings, the published packages (Docker Hub, npm, Maven Central) and the project domains;
- enforces the [Code of Conduct](CODE_OF_CONDUCT.md).

The server is licensed AGPL-3.0, and the SDKs and client packages MIT (see [ADR-001](docs/docs/contributing/adrs.mdx)). A commercial license for the server is offered by the maintainer, as described in the [README](README.md#license).

## How decisions are made

Most decisions are made in the open, on the issue or pull request where they come up. Anyone can comment, and the maintainer decides.

Decisions that affect the architecture, security model, supported platforms or compatibility are recorded:

- **[`DECISIONS.md`](DECISIONS.md)** is the running log: the date, the decision and why, with links to the issues and pull requests. For example, the 2026-11-13 entry made PostgreSQL 16+ the only supported database.
- **[Architecture Decision Records](docs/docs/contributing/adrs.mdx)** write up the decisions most relevant to contributors in Context / Decision / Consequences form. An ADR is added only when the reasoning is on record somewhere; it is not reconstructed after the fact.
- **The [CHANGELOG](CHANGELOG.md)** records every user-facing change, including its **Before you upgrade** notes.

A pull request that makes a breaking change must say so in its description and add an entry to `DECISIONS.md`. This is a checklist item in the pull request template.

Larger designs, such as admin role enforcement in 0.9.0, are written up before the code and then split into several pull requests.

## Code review and merging

These are the rules as they work today:

- **Branches.** Work happens on short-lived branches (`feat/…`, `fix/…`, `chore/…`, `docs/…`). Pull requests target **`dev`**.
- **Review.** The maintainer reviews every pull request from a contributor. The maintainer's own pull requests are not reviewed by a second person, because there is none. Automated checks (code scanning, CI, and the PR hygiene secret scan on pull requests to `main`) are the second pair of eyes.
- **CI must pass.** A pull request is merged only when every CI job is green: lint, import cycles, unit tests, end-to-end tests against PostgreSQL 16, the admin console tests, the SDK suites, the docs build, the Docker build and the Helm install on kind. A red check means the pull request is not ready, never that it needs an override. Branch protection does not enforce this yet; the maintainer does.
- **Merge.** Pull requests are merged with a merge commit.
- **Workflow changes.** Changes to `.github/workflows/` from a contributor are merged only deliberately, after the maintainer has read them.
- **Security fixes** are developed privately and opened as a pull request when the fix is ready to release. See [`SECURITY.md`](SECURITY.md).

## Releases

1. A release pull request (`chore/release-vX.Y.Z`) to `dev` bumps `package.json`, the Helm chart's `appVersion` and `version`, and adds the CHANGELOG entry.
2. A pull request from `dev` to **`main`** promotes the release. Merging it publishes a `main-<sha>` Docker image; `latest` does not move yet.
3. The maintainer tags `vX.Y.Z` on `main`. The tagged image is published as `X.Y.Z`, `X.Y` and `latest`. `release-version-check.yml` checks that the tag, `package.json`, the chart and the CHANGELOG agree; it runs alongside the image build rather than gating it, so they must agree before tagging.
4. After every push to `main`, `dev` is fast-forwarded to `main`.

SDKs and tools are released from their own tags. [Releasing](docs/docs/contributing/releasing.mdx) has the details, and [Versioning and Support](docs/docs/project/versioning-and-support.md) has the version policy.

## Becoming a maintainer

There is no formal application. A contributor can be invited to become a maintainer once they have:

- made several substantial contributions over a few months, with code and reviews that show they understand the security model;
- reviewed other people's pull requests in a way that was useful;
- shown they follow the project's rules: tests, the CHANGELOG, **Before you upgrade** notes, and private handling of security issues.

A new maintainer starts with triage and review rights, and gets merge and release rights later. Maintainers with publishing rights must use two-factor authentication on GitHub and on every registry they publish to.

When the project has more than one maintainer, this document will be updated to describe how they reach decisions together and how a maintainer steps down. Until then, the current maintainer decides.

## Code of Conduct

Everyone taking part in the project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). The maintainer enforces it.

## Changing this document

Changes to this document are made by pull request, like any other change, and recorded in `DECISIONS.md`.
