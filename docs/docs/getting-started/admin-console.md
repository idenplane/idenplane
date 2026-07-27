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

**Admin credentials** — the username and password of an admin account. This is the normal way in. The initial account comes from `ADMIN_USER` and `ADMIN_PASSWORD`, which default to `admin` / `admin`.

**API key** — the value of `ADMIN_API_KEY`. Useful when you have not created an admin account yet, or for a break-glass login.

:::warning
Change the default `admin` / `admin` credentials before exposing an instance to anything. See [Configuration](/getting-started/configuration#api-authentication).
:::

### First run

On a fresh install, `/setup` runs a six-step wizard that takes you from an empty database to a working login. Start there rather than with the console — see [Your First Application](/guides/first-app).

---

## Layout

The console has two levels of navigation.

**Global**, always visible:

| Section | What it's for |
|---|---|
| **Dashboard** | Instance overview |
| **Realms** | List of realms, and the entry point to everything below |
| **Plugins** | Installed plugins, enable and disable |
| **System Status** | Health of the server and its dependencies |
| **Upgrade** | Version upgrades — see [Upgrading](/deployment/upgrading) |

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
