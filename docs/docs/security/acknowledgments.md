---
id: acknowledgments
title: Security Acknowledgments
description: People and teams who reported vulnerabilities in Idenplane privately, with the advisories their reports led to.
---

# Security Acknowledgments

These reporters found vulnerabilities in Idenplane and reported them privately, so a fix could ship before the details were public. Thank you.

| Reporter | Advisory | Severity | Summary | Fixed in |
|---|---|---|---|---|
| [EQSTLab](https://github.com/EQSTLab) | [GHSA-2463-97f9-hw7j](https://github.com/idenplane/idenplane/security/advisories/GHSA-2463-97f9-hw7j) | High | The public setup wizard allowed unauthenticated realm and admin creation on instances that were already set up | 0.8.1 |
| [EQSTLab](https://github.com/EQSTLab) | [GHSA-jfx3-gv42-6qwv](https://github.com/idenplane/idenplane/security/advisories/GHSA-jfx3-gv42-6qwv) | Critical | Default bootstrap admin credentials allowed an unauthenticated super-admin login | 0.8.1 |

Both affected 0.8.0 and earlier. The [0.8.1 CHANGELOG entry](https://github.com/idenplane/idenplane/blob/main/CHANGELOG.md#081---2026-11-14) describes the fixes.

## How reporters are credited

- A reporter is credited in the GitHub Security Advisory, in the CHANGELOG entry of the fixing release, and on this page.
- Credit uses the name or handle the reporter chooses. A reporter who wants to stay anonymous is not named anywhere.
- Credit is given for reports that lead to a fix or an advisory. There is no bug bounty.

To report a vulnerability, follow [`SECURITY.md`](https://github.com/idenplane/idenplane/blob/main/SECURITY.md).
