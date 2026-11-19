---
id: unattended-bootstrap
title: Unattended Bootstrap
sidebar_position: 3
description: Set up a new Idenplane instance from configuration alone at its first start, with realms, clients and SMTP in place and the setup wizard closed, for automated and GitOps installs.
---

# Unattended Bootstrap

A new instance normally waits for an administrator to sign in and run the setup wizard. Unattended bootstrap sets the instance up from configuration instead. At its first start, the realms you declare are created and the setup wizard is closed for good, so no one ever needs to open it. Use it whenever installs are automated: provisioning scripts, Docker Compose on a VM, Terraform, Helm with Argo CD or Flux.

It works with the Docker image alone: one environment variable plus either a mounted file or the document itself. The [Helm chart](kubernetes.mdx#unattended-bootstrap) only wraps the same mechanism.

## What it does

At startup, before the server accepts any request:

1. The `master` realm and its admin are created from `ADMIN_USER` / `ADMIN_PASSWORD`, as on every first start (see [How the first admin password is chosen](../configuration/environment-variables.md#how-the-first-admin-password-is-chosen)).
2. If the instance is **fresh**, every realm in the bootstrap document is created, then the setup wizard is marked completed. Fresh means the setup wizard was never completed or skipped, and no realm other than `master` exists. All of it happens in **one database transaction**, so either everything is applied or nothing is.
3. Once the wizard is closed, every wizard write answers `409 Setup is already complete`, exactly as after a person completes it.

| Setup wizard step | Unattended equivalent |
|---|---|
| Admin account | `ADMIN_USER` / `ADMIN_PASSWORD` (the console admin, in `master`). A realm user with a password: `users[].initialPassword` |
| Realm settings | `realms[].realm` (`name`, `displayName`, and any other realm setting) |
| SMTP | `realms[].realm.smtpHost`, `smtpPort`, `smtpUser`, `smtpPassword`, `smtpFrom`, `smtpSecure` |
| Client application | `realms[].clients[]`, with the secret you choose in `clientSecret` |
| Complete | Automatic: the wizard is closed in the same transaction |

## Configuration

| Variable | Secret | Meaning |
|---|---|---|
| `BOOTSTRAP_FILE` | No (the path) | Path of the bootstrap document inside the container, e.g. a read-only bind mount. |
| `BOOTSTRAP_JSON` | Treat as secret | The bootstrap document itself, for `docker run` without a mount. Set either variable, not both: with both set, the server does not start. |
| any variable a `${env:NAME}` names | Yes | Secrets used by the document. Pass them like any other secret environment variable. |

With neither variable set, nothing changes: the setup wizard is left to an administrator.

## The bootstrap document

```json
{
  "version": 1,
  "realms": [
    {
      "version": 2,
      "realm": {
        "name": "acme",
        "displayName": "Acme",
        "smtpHost": "smtp.example.com",
        "smtpPort": 587,
        "smtpUser": "mailer",
        "smtpPassword": "${env:ACME_SMTP_PASSWORD}",
        "smtpFrom": "noreply@example.com"
      },
      "clients": [
        {
          "clientId": "acme-web",
          "name": "Acme web app",
          "clientSecret": "${env:ACME_WEB_CLIENT_SECRET}",
          "redirectUris": ["https://app.example.com/callback"],
          "grantTypes": ["authorization_code", "refresh_token"]
        }
      ],
      "roles": [{ "name": "app-admin" }],
      "users": [
        {
          "username": "owner",
          "email": "owner@example.com",
          "initialPassword": "${env:ACME_OWNER_PASSWORD}",
          "roles": [{ "name": "app-admin" }]
        }
      ]
    }
  ]
}
```

- `version` is `1`, the bootstrap format. No other top-level key is accepted.
- `realms` is optional. Each entry is a **realm export document, version 2**, the format `GET /admin/realms/{realm}/export` returns and `POST /admin/realms/import` takes, so it can hold clients, roles, groups, client scopes, identity providers, authentication flows, organizations and users. The simplest way to write one is to configure a realm once, export it, and edit the export. The default scopes (`openid`, `profile`, `email`, ...) are created when the document has none. New realms get the [secure defaults](../security/secure-defaults.md).
- With no realms, `{"version": 1}`, the instance only has its setup wizard closed.
- `master` and `public` cannot be declared. The `master` realm and its admin always come from `ADMIN_USER` / `ADMIN_PASSWORD`.

### Secrets: `${env:NAME}`

Any string in the document may contain `${env:NAME}`. At startup it is replaced with the value of the environment variable `NAME`. Keep the document free of secrets and pass them as environment variables, from an `env_file`, a Docker or Kubernetes secret, or your provisioning tool.

- A variable that is not set, or is empty, is an error.
- The server's own secrets (`ADMIN_API_KEY`, `ADMIN_PASSWORD`, `WEBHOOK_SECRET_KEY`, `WEBHOOK_ENCRYPTION_SALT` and their `_PREVIOUS` forms, `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `REDIS_URL`) cannot be referenced.
- `$${env:NAME}` keeps the text `${env:NAME}` as it is.
- Tools that interpolate `${...}` themselves see these placeholders first. In a Compose file (inline `environment:` or `configs: content:`), write `$${env:NAME}`. With Flux post-build substitution, also write `$${env:NAME}`. A mounted file is not interpolated by either.

Secrets are stored as everywhere else in Idenplane. Client secrets and passwords are hashed. The SMTP password and other credentials are encrypted with `WEBHOOK_SECRET_KEY`. No value from the document is ever written to the log, and error messages name a path in the document (`realms[0].clients[1].clientSecret`), never a value.

### Checks

The whole document is checked before anything is written. The start fails if:

- the JSON is invalid, a key is unknown, or a realm document does not pass the [realm import](../api/realms.md) validation;
- a confidential client that authenticates with a secret (the default) has no `clientSecret`. Without one it could never sign in. A secret written in the document must be at least 32 characters (`openssl rand -hex 32`) and not a placeholder. A stored hash, from an export made with `includeSecrets`, is kept as is;
- an `initialPassword` is shorter than 12 characters or a known default (`admin`, `password`, `changeme`, ...);
- a realm is declared twice, or is `master` or `public`.

## Startup, readiness and failure

Bootstrap runs before the server listens. While it runs, `/health` and `/health/ready` do not answer, so no orchestrator sends traffic to a half-configured instance. When it cannot complete:

- the process logs `Instance bootstrap (BOOTSTRAP_FILE) failed; nothing was applied and the server will not start: <reason>` and exits with a non-zero code;
- the transaction is rolled back, so the database holds nothing from the bootstrap and the setup wizard is still open but unreachable, because the server is not running;
- the next start tries again from scratch. Fix the document or the missing variable and restart.

A container that keeps restarting, or a pod that never becomes ready, is therefore the signal that bootstrap failed. With `docker compose up --wait` the command fails, and with Helm `--wait` the release fails.

## Restarts, changes and existing instances

- **Restarts.** On every later start the instance is no longer fresh. The document is not applied again, even if it changed, and the log says `Setup is already complete; BOOTSTRAP_FILE applies only to a fresh instance and was not applied again`. Bootstrap is not a reconciler. Manage a running instance with the admin console, the [admin API](../api/index.mdx) or the Terraform provider. Leaving the variable set is harmless.
- **Existing instances.** On an instance that already has realms but never closed its wizard (installed before this feature, for example), nothing is created or changed. The log carries a warning naming the existing realms, and the server starts normally. Bootstrap never overwrites an instance that is in use.
- **Several instances at once.** Replicas, `WEB_CONCURRENCY` workers and a rolling start may all bootstrap the same empty database at the same moment. They serialize on the setup wizard's row lock: one applies the document, the others wait for it and then find setup complete. The setup wizard, if someone opens it at that moment, takes the same lock.

## Docker Compose

This compose file brings up a fully configured instance on a VM in one command. Keep the three files in one directory.

`bootstrap.json` holds no secrets:

```json
{
  "version": 1,
  "realms": [
    {
      "version": 2,
      "realm": { "name": "acme", "displayName": "Acme" },
      "clients": [
        {
          "clientId": "acme-web",
          "clientSecret": "${env:ACME_WEB_CLIENT_SECRET}",
          "redirectUris": ["https://app.example.com/callback"],
          "grantTypes": ["authorization_code", "refresh_token"]
        }
      ]
    }
  ]
}
```

`.env` holds the secrets. Generate each value with `openssl rand`, keep the file readable by its owner only (`chmod 600`), and never commit it:

```bash
POSTGRES_PASSWORD=<openssl rand -hex 24>
ADMIN_API_KEY=<openssl rand -hex 32>
ADMIN_PASSWORD=<openssl rand -hex 24>
WEBHOOK_SECRET_KEY=<openssl rand -hex 32>
WEBHOOK_ENCRYPTION_SALT=<openssl rand -hex 16>
ACME_WEB_CLIENT_SECRET=<openssl rand -hex 32>
```

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: idenplane
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in .env}
      POSTGRES_DB: idenplane
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U idenplane"]
      interval: 5s
      retries: 10
    restart: unless-stopped

  app:
    image: islamawad/idenplane:latest
    env_file: .env
    environment:
      DATABASE_URL: postgresql://idenplane:${POSTGRES_PASSWORD}@db:5432/idenplane
      NODE_ENV: production
      BASE_URL: https://auth.example.com
      ADMIN_USER: admin
      BOOTSTRAP_FILE: /etc/idenplane/bootstrap.json
    volumes:
      - ./bootstrap.json:/etc/idenplane/bootstrap.json:ro
    ports:
      - "127.0.0.1:3000:3000"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://localhost:3000/health/ready"]
      interval: 10s
      start_period: 60s
      retries: 6
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
```

```bash
docker compose up -d --wait --wait-timeout 300
```

Compose reads `.env` to substitute `POSTGRES_PASSWORD` into the file, and `env_file: .env` passes every value, `ACME_WEB_CLIENT_SECRET` included, into the container. `--wait` returns once the app is healthy, and fails if bootstrap failed. Put a TLS-terminating proxy in front of port 3000 (see [Docker Compose Deployment](docker.mdx)). Pin the image to a version (`islamawad/idenplane:X.Y.Z`) for repeatable installs.

Without a mount, pass the document itself:

```bash
docker run -d --env-file .env \
  -e DATABASE_URL=postgresql://idenplane:...@db:5432/idenplane \
  -e BOOTSTRAP_JSON="$(cat bootstrap.json)" \
  islamawad/idenplane:latest
```

## After bootstrap

- The console admin is `ADMIN_USER` in `master`. On a new install a second factor is required for every admin, so the first console sign-in goes to MFA enrolment. Machine calls to the admin API use `ADMIN_API_KEY`. See [Admin console MFA](../security/admin-mfa.md).
- `GET /setup-wizard/status` (with the admin API key) answers `wizardCompleted: true`. Use it, or the log line `Instance bootstrapped from BOOTSTRAP_FILE: created realm(s) 'acme'; setup wizard closed`, to confirm.
- The document can stay in place. Remove the secrets it references from the environment only if nothing else needs them; on later starts they are not read again.
