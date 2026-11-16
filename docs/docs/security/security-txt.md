---
id: security-txt
title: security.txt
description: The RFC 9116 security.txt for idenplane.com, where it is served from, how to renew it, and why the Idenplane server does not serve one.
---

# security.txt

[RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) defines `/.well-known/security.txt`, a file that tells researchers how to report a vulnerability to whoever runs a website.

## The file for idenplane.com

This is the content to serve at `https://idenplane.com/.well-known/security.txt`:

```text
# Idenplane vulnerability disclosure
# RFC 9116: https://www.rfc-editor.org/rfc/rfc9116

Contact: https://github.com/idenplane/idenplane/security/advisories/new
Contact: mailto:security@idenplane.com
Expires: 2027-11-01T00:00:00Z
Preferred-Languages: en, ar
Canonical: https://idenplane.com/.well-known/security.txt
Policy: https://github.com/idenplane/idenplane/blob/main/SECURITY.md
Acknowledgments: https://github.com/idenplane/idenplane/blob/main/docs/docs/security/acknowledgments.md
```

- `Contact` lines are listed in order of preference. GitHub private vulnerability reporting comes first. The second line is a role address for the project, not a personal one.
- `Policy` and `Acknowledgments` point to files in the repository on `main`, so they resolve wherever the documentation site is hosted.
- RFC 9116 says `Expires` should be less than a year away. Renew the file before that date.

## Where it is served from

The website at idenplane.com is built from a separate repository, [`idenplane/landing`](https://github.com/idenplane/landing). That repository serves the file from `public/.well-known/security.txt`. To change it:

1. Copy the block above into `public/.well-known/security.txt` in the landing repository.
2. Merge it to that repository's default branch. The site deploys from there.
3. Check it: `curl -s https://idenplane.com/.well-known/security.txt`.

The copy on this page is the source. Change it here first, then in the landing repository.

:::caution Order matters
The `Policy` and `Acknowledgments` URLs point at files on `main`. Update the landing repository only after this page and the acknowledgments page have reached `main`, or the file will link to pages that don't exist yet.
:::

### Renewing

Once a year, or whenever a contact or URL changes:

1. Set `Expires` to a date less than a year away.
2. Update this page.
3. Copy the result to the landing repository, as above.

## Why the Idenplane server does not serve one

A `security.txt` describes the security contact for the domain that serves it. An Idenplane server runs on its operator's domain, for example `auth.example.com`. If the server sent this file, people who found a problem in that operator's deployment would report it to the Idenplane project, not to the operator.

So the server has no `/.well-known/security.txt` route. If you run Idenplane, publish your own `security.txt` from your reverse proxy or web server, with your own contact. Report vulnerabilities in Idenplane itself to the project, as described in [`SECURITY.md`](https://github.com/idenplane/idenplane/blob/main/SECURITY.md).
