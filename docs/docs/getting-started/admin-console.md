---
id: admin-console
title: Admin Console
sidebar_position: 3
description: Tour of the Idenplane admin console — signing in, realms, and where each setting lives
---

# Admin Console

The admin console is served by the same process as the API, at **`/console`**. Everything it does goes through the Admin API, so anything here can also be scripted — see the [API Reference](/api).

---

## Signing in

Go to `http://localhost:3000/console`. The login page offers two modes:

**Admin credentials** — the username and password of an admin account. This is the normal way in. The initial account is `ADMIN_USER` (default `admin`) with the password from `ADMIN_PASSWORD`. There is no default password: if `ADMIN_PASSWORD` is unset outside production, the first start generates one and prints it once in its log. See [How the first admin password is chosen](/configuration/environment-variables#how-the-first-admin-password-is-chosen).

**API key** — the value of `ADMIN_API_KEY`. Useful for automation, or for a break-glass login.

:::warning
Change the initial admin password after the first sign-in, especially if it was generated and printed in the log.
:::

### First run

On a fresh install, sign in as a super-admin (the initial admin, or with the API key) and open **`/console/setup`**: a six-step wizard that takes you to a working login. See [Your First Application](/guides/first-app).

The wizard is for super-admins only, and it runs once: after it is completed or skipped, the page says setup is already complete and links to the console.

---

## Layout

The console has two levels of navigation.

**Global**, always visible:

| Section | What it's for |
|---|---|
| **Dashboard** | Instance overview |
| **Realms** | List of realms, and the entry point to everything below |
| **Admin Accounts** | Admins, their roles, and the realms each realm-admin manages (super-admin) |
| **Plugins** | Installed plugins, enable and disable (super-admin) |
| **System Status** | Health of the server and its dependencies (super-admin) |
| **Upgrade** | Version upgrades — see [Upgrading](/deployment/upgrading) (super-admin) |

What you see and can change depends on your admin role — see [Admin Roles](/getting-started/admin-roles).

**Per-realm**, once you pick a realm. Almost all configuration lives here, because almost everything in Idenplane is scoped to a realm.

---

## Inside a realm

### Identity

| Section | What you manage |
|---|---|
| **Users** | Accounts, credentials, attributes, role assignments |
| **Groups** | Group hierarchy and group-level role mappings |
| **Roles** | Realm roles and client roles |
| **Service Accounts** | Machine identities for client-credentials flows |
| **Non-Human Identity** | Workload identities, with their own analytics view |
| **Organizations** | Multi-tenant grouping of users within a realm |

### Applications

| Section | What you manage |
|---|---|
| **Clients** | OAuth 2.0 clients — redirect URIs, flows, secrets |
| **Client Scopes** | Reusable scope definitions mapped onto clients |
| **Authorization** | Fine-grained authorization policies |
| **Custom Attributes** | Extra user fields, and how they surface in tokens |
| **SCIM** | SCIM 2.0 provisioning endpoints |

### External identity

| Section | What you manage |
|---|---|
| **Identity Providers** | OIDC providers for social and enterprise login |
| **SAML Providers** | SAML identity providers |
| **User Federation** | External user stores |

### Sign-in behaviour

| Section | What you manage |
|---|---|
| **Auth Flows** | The steps a user goes through when authenticating |
| **Registration Settings** | Whether self-registration is open, and on what terms |
| **Registration Fields** | Which fields the registration form collects |
| **Registration Approvals** | Queue of sign-ups awaiting an admin decision |
| **Consent Categories** | Consent grouping, plus a statistics view |

### Operations

| Section | What you manage |
|---|---|
| **Sessions** | Active sessions, with the ability to revoke |
| **Events** | Authentication events |
| **Admin Events** | Administrative actions, separately from user events |
| **Risk Dashboard** | Continuous-verification signals and risk scoring |
| **Risk Policies** | What the risk engine does about them |
| **Webhooks** | Outbound event delivery |
| **Theme Builder** | Per-realm branding for login, consent, account and email pages |

---

## Realm settings

The realm **Overview** page holds the settings that apply to the realm as a whole, grouped into tabs:

| Tab | Covers |
|---|---|
| **General** | Name, display name, enabled state |
| **Tokens** | Access and refresh token lifespans, session timeouts |
| **Email** | SMTP configuration and templates |
| **SMS** | SMS provider configuration |
| **Security** | Password policy, brute-force protection, MFA requirements |
| **Events** | Which events are recorded, and for how long |
| **Theme** | Theme selection |
| **Magic Link** | Passwordless email sign-in |
| **Locale** | Default locale |

Most of these have an environment-variable equivalent listed in [Configuration](/getting-started/configuration). Realm settings win where both exist, since they are per-realm and the variables are per-instance.

---

## Next steps

<div className="row">

[**Your First Application**](/guides/first-app)
Register a client and sign a user in

[**Configuration**](/getting-started/configuration)
Environment variables and server options

[**API Reference**](/api)
Everything the console does, over HTTP

</div>
