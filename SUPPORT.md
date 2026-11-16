# Support

Idenplane is maintained by one person ([@Islamawad132](https://github.com/Islamawad132)) in their own time. All support is best effort. There is no paid support and no response-time guarantee.

## Where to go

| You want to… | Go to |
|---|---|
| Ask a question about installing, configuring or using Idenplane | [GitHub Discussions, Q&A](https://github.com/idenplane/idenplane/discussions/new?category=q-a) |
| Suggest an idea or discuss a design | [GitHub Discussions, Ideas](https://github.com/idenplane/idenplane/discussions/categories/ideas) |
| Report a bug | [Open a bug report](https://github.com/idenplane/idenplane/issues/new?template=bug_report.yml) |
| Request a feature | [Open a feature request](https://github.com/idenplane/idenplane/issues/new?template=feature_request.yml) |
| Report a security vulnerability | **Privately**, through [GitHub private vulnerability reporting](https://github.com/idenplane/idenplane/security/advisories/new). See [`SECURITY.md`](SECURITY.md). Never in a public issue or discussion. |
| Ask about a commercial license | See the License section of the [README](README.md#license) |

Before asking, check the [documentation](docs/docs/intro.md), the [Troubleshooting & FAQ](docs/docs/troubleshooting.mdx) page and the [CHANGELOG](CHANGELOG.md). After an upgrade, the release's **Before you upgrade** notes answer most "it stopped working" questions.

## Reporting a bug

A useful bug report has:

- the Idenplane version (the release, the image tag, or the commit if you built from source);
- how you deploy it: Docker Compose, Helm, or from source;
- the PostgreSQL version, and whether Redis is enabled;
- the steps to reproduce, what you expected and what happened;
- logs, with secrets, tokens and personal data removed.

If the bug looks like a way to bypass authentication or authorisation, or to read data you should not see, treat it as a vulnerability and report it privately.

## What is supported

- **The latest release only.** Fixes, including security fixes, ship in a new release. Older releases get no backports. Upgrade first and check whether the problem is still there.
- **PostgreSQL 16 or later.** No other database is supported.
- **The official Docker image, the Helm chart in `helm/idenplane`, and running from source** with the Node.js version used by the image (24).

Which versions of PostgreSQL, Node.js, Redis, Kubernetes and the SDKs each release was tested with is in [Versioning and Support](docs/docs/project/versioning-and-support.md).

Help with your own infrastructure, such as reverse proxies, ingress controllers, managed databases or identity-provider integrations, is given when there is time. It is not guaranteed.

## What to expect

- Questions and bug reports are read, usually within a few days. Some take longer.
- Security reports come first. The targets for them are in [`SECURITY.md`](SECURITY.md).
- Confirmed bugs that affect security or data integrity come before features.
- An issue may be closed if it cannot be reproduced on the latest release, or if the information asked for does not arrive.

If something is urgent for you, say why in the issue or discussion. That helps with prioritising, but it is not a promise of a faster answer.

## Contributing a fix

Pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`GOVERNANCE.md`](GOVERNANCE.md) for how changes are reviewed and merged.
