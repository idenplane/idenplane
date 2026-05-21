# Security Policy

## Reporting a Vulnerability

The Idenplane team takes security seriously. If you believe you have found a security vulnerability, please report it to us privately so that we have an opportunity to fix it before public disclosure.

**Please do _not_ report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

### How to Report

Send a detailed report to **security@idenplane.com**.

To help us triage your report quickly, please include:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof-of-concept
- Affected versions / commits, if known
- Any suggested fix or mitigation
- Your name and contact info (for credit, optional)

You should receive an initial response within **48 hours**. If you do not, please follow up to ensure we received your original report.

## Supported Versions

Only the latest released version of Idenplane receives security updates. Older versions should be upgraded.

| Version | Supported |
|---------|-----------|
| Latest (`main`) | ✅ |
| Older releases | ❌ |

## Disclosure Policy

When a vulnerability is reported, we will:

1. Confirm receipt within 48 hours.
2. Investigate and validate the report.
3. Develop and test a fix.
4. Release a patched version.
5. Publicly disclose the vulnerability via a GitHub Security Advisory, crediting the reporter (unless they prefer to remain anonymous).

We aim to address all valid reports within **90 days** of the initial report. Critical issues are prioritized and may be addressed faster.

## Scope

In scope:

- The Idenplane server (`src/`)
- Official client SDKs in `packages/`
- The admin UI (`admin-ui/`)
- Docker images published under `islamawad/idenplane`
- Helm charts and Terraform/Pulumi providers under this repository

Out of scope:

- Self-hosted instances misconfigured by the operator (e.g. default credentials left unchanged)
- Vulnerabilities in third-party dependencies that have not been disclosed upstream
- Social engineering or physical attacks

## Safe Harbor

We will not take legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, or service disruption
- Only interact with their own accounts or accounts where they have explicit permission
- Give us a reasonable time to respond before any public disclosure
- Do not exploit the issue beyond what is necessary to demonstrate it

Thank you for helping keep Idenplane and its users safe.
