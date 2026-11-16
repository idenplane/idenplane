# Security Policy

If you believe you have found a security vulnerability in Idenplane, please report it privately, so it can be fixed before the details are public.

**Please do _not_ report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

## How to Report

**Preferred: GitHub private vulnerability reporting.** Open a private report at
**https://github.com/idenplane/idenplane/security/advisories/new**.
Only you and the maintainer can see it. The discussion, the fix and the advisory all happen in one place.

**Without a GitHub account:** email **security@idenplane.com**.

To help triage your report quickly, please include:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof-of-concept
- Affected versions / commits, if known
- Any suggested fix or mitigation
- How you would like to be credited, or that you prefer to stay anonymous

Reports in English or Arabic are welcome.

## Supported Versions

Only the latest release receives security fixes. Fixes ship as a new release; there are no backports to older versions.

| Version | Supported |
|---------|-----------|
| Latest release (currently 0.9.1) | ✅ |
| Any earlier release | ❌ Upgrade to the latest release |

The full policy, including SDKs and deprecations, is in [Versioning and Support](docs/docs/project/versioning-and-support.md).

## Disclosure Process and Timelines

Idenplane has a single maintainer, so these are best-effort targets, not guarantees:

1. **Acknowledgement:** within 3 business days of your report. If you hear nothing after a week, please follow up on the report or by email.
2. **Assessment:** the maintainer confirms or disputes the issue and agrees a severity with you, usually within 10 business days.
3. **Fix:** a fix is developed privately. Critical and high severity issues are prioritised over all other work. The goal is a fixed release within 90 days of the report, and much sooner for critical issues.
4. **Release:** the fix ships in a new release. Its CHANGELOG entry has a **Security** section and, when you need to act, a **Before you upgrade** section.
5. **Disclosure:** the GitHub Security Advisory is published when the fixed release is out, with the affected and fixed versions.

Please give the project a reasonable time to fix the issue before you disclose it publicly. If the 90 days run out, or the issue is already being exploited, talk to the maintainer on the report and agree a disclosure date together.

## How Reporters Are Credited

- You are credited in the GitHub Security Advisory, in the CHANGELOG entry of the fixing release, and on the [Security Acknowledgments](docs/docs/security/acknowledgments.md) page.
- You choose the name or handle used. If you prefer to stay anonymous, you are not named anywhere.
- There is no bug bounty.

## Scope

In scope:

- The Idenplane server (`src/`)
- Official client SDKs in `packages/`
- The admin UI (`admin-ui/`)
- Docker images published under `islamawad/idenplane`
- Helm charts and the Terraform provider under this repository

Out of scope:

- Self-hosted instances misconfigured by the operator (e.g. default credentials left unchanged)
- Vulnerabilities in third-party dependencies that have not been disclosed upstream
- Social engineering or physical attacks
- Vulnerabilities in a specific organisation's Idenplane deployment that come from its own configuration. Report those to that organisation.

## Security design and assessment

- [Threat model](docs/docs/security/threat-model.md): assets, trust boundaries, STRIDE threats per boundary, the mitigation in the code for each, and the residual risk.
- [OWASP ASVS 5.0 Level 2 self-assessment](docs/docs/security/asvs-assessment.md): every Level 1 and 2 requirement with its status and evidence from the code ([CSV](docs/static/security/asvs-5.0-l2-assessment.csv)).
- [Secure defaults](docs/docs/security/secure-defaults.md): the security settings a new realm starts with, and how to apply them to older realms.

These are maintained by the project and have not been reviewed by a third party. If you find a threat or a gap they miss, report it as described above.

## Safe Harbor

We will not take legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, or service disruption
- Only interact with their own accounts or accounts where they have explicit permission
- Give us a reasonable time to respond before any public disclosure
- Do not exploit the issue beyond what is necessary to demonstrate it

## Related

- [Security Acknowledgments](docs/docs/security/acknowledgments.md)
- [security.txt for idenplane.com](docs/docs/security/security-txt.md)
- [Threat model](docs/docs/security/threat-model.md)
- [Support](SUPPORT.md)

Thank you for helping keep Idenplane and its users safe.
