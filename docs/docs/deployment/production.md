---
id: production
title: Production Checklist
sidebar_position: 4
description: What to set up before Idenplane holds real accounts — public HTTPS, secrets, an encrypted and verified database connection, and backups stored off the host.
---

# Production Checklist

The quick starts run Idenplane on one machine, on `localhost`, with secrets in a local `.env`. Before real users depend on it, go through the five areas below. Each one names what to set and how to check it.

---

## 1. Public HTTPS

Idenplane serves plain HTTP on port 3000. Terminate TLS in front of it with a certificate from a public CA.

- **Kubernetes:** enable the chart's ingress with cert-manager, as `helm/idenplane/values.production.yaml` does (`cert-manager.io/cluster-issuer`, `ingress.tls`).
- **Docker Compose:** `docker-compose.nginx.yml` puts nginx in front. Give it a certificate from Let's Encrypt or your CA.

Then set:

| Setting | Value |
|---|---|
| `BASE_URL` | The public `https://` origin, for example `https://auth.example.com`. Issuer URLs, redirects and e-mail links are built from it. |
| `TRUSTED_PROXIES` | The address or CIDR of your proxy or ingress only, never `*`. Client IPs for rate limits and audit logs come from `X-Forwarded-For`, and only these hops are trusted. |

**Check:** `curl https://auth.example.com/realms/master/.well-known/openid-configuration` shows `"issuer": "https://auth.example.com/realms/master"`.

Applications on other sites can use single sign-on: the SSO cookie is `SameSite=Lax` and `Secure`, so it travels on the authorization and logout redirects and only over HTTPS.

---

## 2. Secrets

Four values protect the installation. Generate each one once and keep it.

| Key | What it protects | Can it change later? |
|---|---|---|
| `ADMIN_PASSWORD` | The initial `admin` user, created on the first start | Only used once. Afterwards, change the password in the console. |
| `ADMIN_API_KEY` | The static admin API credential (at least 32 characters) | Yes. Clients using it must be updated. |
| `WEBHOOK_SECRET_KEY` | Encrypts every stored secret at rest (see below) | Only by [rotating the encryption key](#rotating-the-encryption-key). Simply replacing it makes stored secrets unreadable, and Idenplane refuses to start. |
| `WEBHOOK_ENCRYPTION_SALT` | Derives the key above | Only by rotating the encryption key, as above. |

Keep them in a secret manager, not in a file on the server:

- **Kubernetes:** let the chart generate them, which it does on first install and keeps on upgrades. Or, with Argo CD, Flux or `helm template`, create them yourself and set `secrets.existingSecret` (see [Kubernetes → Secrets](kubernetes.mdx#2-secrets)). External Secrets Operator, Sealed Secrets and SOPS all produce a Secret the chart can use.
- **Docker Compose:** `scripts/setup-env.cjs` writes `.env` with mode `0600`. Back that file up to your secret manager and restrict who can read it on the host.

**Back up the two webhook keys separately from the database.** A database backup without them cannot decrypt its stored secrets.

### Encryption at rest

`WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT` derive one AES-256-GCM key. Despite the name, it encrypts every secret Idenplane must read back later:

- realm SMTP password, CAPTCHA secret keys, and email and SMS provider credentials;
- identity provider (OIDC and social) client secrets;
- LDAP federation bind credentials;
- audit log stream HTTP header values;
- secret-named keys of organization SSO connection configs (`clientSecret`, `password`, `privateKey`, `…Token`, `apiKey` and the like);
- realm signing keys (the private key that signs tokens and SAML assertions);
- TOTP seeds, SMS factor phone numbers, NHI private keys and webhook signing secrets;
- the SMTP password entered in the setup wizard.

Passwords, client secrets, API keys, SCIM tokens and session tokens are hashed, not encrypted, and need no key. The admin API never returns an encrypted secret: it returns `••••••`, and sending `••••••` back on an update keeps the stored value.

On every start, Idenplane checks that the key is the one the stored secrets were encrypted with, using a check value kept in the `encryption_key_check` table. With another key it **refuses to start** rather than read or rewrite secrets with the wrong key: restore the previous `WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT`, or rotate to the new key as described below. The same start encrypts any secret still stored in plaintext by an older version; it is safe with several replicas or workers starting at once.

Each value encrypted by this version starts with `ek1.` and a short key id (8 hex characters derived from the key, never the key itself), so Idenplane knows which key opens it. Values written by earlier versions have no key id and stay readable.

### Rotating the encryption key

To replace `WEBHOOK_SECRET_KEY` (and, if you like, `WEBHOOK_ENCRYPTION_SALT`) with new values, for example after a leak or under a key-rotation policy, keep the old pair available as the *previous* key while Idenplane re-encrypts every stored secret with the new one.

1. **Back up** the database and the current `WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT`. The server must already have started once on this version, with the current key.
2. **Generate a new key**, and a new salt if you want to change it too: `openssl rand -hex 32` and `openssl rand -hex 16`.
3. **Stop every replica and worker** (scale to zero, or use the `Recreate` strategy). A process still running with only the old key cannot read what is re-encrypted, and what it writes stays under the old key.
4. **Configure both keys** and start Idenplane:
   - `WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT`: the new values;
   - `WEBHOOK_SECRET_KEY_PREVIOUS` and `WEBHOOK_ENCRYPTION_SALT_PREVIOUS`: the old values. Leave out either one if it is unchanged; it defaults to the current one.
5. **Wait for the start to finish.** Before it serves requests, Idenplane:
   - checks that the old key decrypts the `encryption_key_check` row. If neither key does, it refuses to start and writes nothing;
   - reads every encrypted value. If one decrypts with neither key, it refuses to start, names the value, and writes nothing (see below);
   - re-encrypts every value under the old key with the new key, in batches, each value only if it was not changed meanwhile;
   - rewrites the key check row with the new key, last. If the start is interrupted, the next one simply continues: values already moved are skipped.

   When it is done, it logs `Key rotation complete: every stored secret is encrypted with the current key (id …)`.
6. **Remove `WEBHOOK_SECRET_KEY_PREVIOUS` and `WEBHOOK_ENCRYPTION_SALT_PREVIOUS`** and restart. From now on only the new key is needed. Keep the old one with the pre-rotation backup only, since that backup needs it.

What it covers: every value listed above, in the configuration tables, webhook secrets, NHI private keys, SMS phone numbers and all TOTP seeds. It does not cover short-lived state:

- A pending SMS phone enrolment or SMS code keeps working while the previous key is configured.
- One-time codes (email and SMS) and custom-flow sign-in links are hashed with a key derived from the current key. Those issued before the restart stop matching, so users request a new one.
- The per-phone and per-IP SMS sending limits start a new window.

**How long it takes.** The start reads every encrypted value twice (a read-only check, then the rewrite). Measured on PostgreSQL 16 on a developer machine, about 5,000 TOTP or SMS factors per second, so roughly 10 seconds for 50,000 enrolled users and 3 to 4 minutes per million. The chart's startup probe allows 5 minutes. With more than about a million TOTP users, raise `startupProbe.failureThreshold` for the rotation. While a previous key stays configured, every start reads all values again (about 4 seconds per 50,000), which is one more reason to remove it in step 6.

**A value that decrypts with neither key** stops the start with a list of where it is (table, row id and field). That value was encrypted with a third key, or is damaged. Configure the key it was encrypted with as the previous key if you have it. If it is lost for good, start once with `STORED_SECRETS_ACCEPT_UNREADABLE=true`. The rotation then completes, leaves those values as they are, and logs them. Set each of them again in the admin console, then remove the variable.

**Without downtime.** If you cannot stop every replica, roll out in two steps, so that every process can always read both keys:

1. Roll out the old key as current and the new one as previous: `WEBHOOK_SECRET_KEY`=old, `WEBHOOK_SECRET_KEY_PREVIOUS`=new.
2. Roll out the swap: `WEBHOOK_SECRET_KEY`=new, `WEBHOOK_SECRET_KEY_PREVIOUS`=old.
3. When the rollout has finished, restart once more: this picks up values that an old-config replica wrote during step 2. Wait for the log line from step 5, then remove the previous key as in step 6.

:::warning Upgrading to the version that encrypts these secrets
Its first start encrypts the values older versions stored in plaintext, and older versions cannot read them afterwards. Stop the old version before starting the new one (scale to zero, or the `Recreate` strategy) instead of a rolling update, and keep the pre-upgrade database backup: going back needs it. On the first start, if stored values that look encrypted do not decrypt with the configured key, Idenplane refuses to start. Restore the previous key; only if you are sure the key is right (the values are plaintext that merely looks like ciphertext), start once with `STORED_SECRETS_ACCEPT_KEY=true`.
:::

---

## 3. Database: TLS with certificate verification

Use PostgreSQL 16 or later, preferably a managed service. Give Idenplane its own role. It needs to own its schema, because migrations run on start.

Connect over TLS **and verify the server's certificate**:

```bash
DATABASE_URL=postgresql://idenplane:<password>@db.example.com:5432/idenplane?sslmode=verify-full&sslrootcert=/etc/idenplane/db-ca.pem
```

- `sslmode=verify-full` checks the certificate chain and that the hostname matches. `sslrootcert` is the CA that signed the server certificate; your cloud provider publishes it for managed databases. Mount it read-only into the container.
- The Docker image translates these parameters for the migration step: Prisma's migration engine spells them differently and would otherwise encrypt without verifying. If you need a different URL for migrations, for example through a pooler, set `DATABASE_MIGRATION_URL`, and it is used as is.
- `sslmode=require` alone encrypts, but it does not prove that you are talking to your database. Don't rely on it.

**Check:**
- Start with a wrong `sslrootcert`. The container must exit during migrations with `certificate verify failed`.
- With the right one, run `SELECT ssl FROM pg_stat_ssl JOIN pg_stat_activity USING (pid) WHERE usename = 'idenplane'` on the database. Every row should be `t`.

Use a connection pooler in *session* mode, or connect directly. Transaction mode needs `CACHE_L1=off` and `LEADER_ELECTION=off`; see the 0.6.0 upgrade notes.

---

## 4. Backups stored off the host

The built-in backup (`BACKUP_DIR`, the chart's `backups.enabled`) writes dumps next to the server. It exists for upgrade rollbacks. It is not a backup strategy: it is lost together with the disk or the cluster.

Schedule `pg_dump` to storage in another failure domain, encrypt it, and keep several generations. A Kubernetes example, which uploads a custom-format dump to S3 every night:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: idenplane-db-backup
spec:
  schedule: "17 2 * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: postgres:17-bookworm   # client major >= server major
              envFrom:
                - secretRef:
                    name: idenplane-backup     # PGHOST, PGUSER, PGPASSWORD, PGDATABASE, AWS_* , BUCKET
              env:
                - name: PGSSLMODE
                  value: verify-full
                - name: PGSSLROOTCERT
                  value: /etc/db-ca/ca.pem
              volumeMounts:
                - name: db-ca
                  mountPath: /etc/db-ca
                  readOnly: true
              command: ["/bin/sh", "-c"]
              args:
                - |
                  set -e
                  apt-get update -qq && apt-get install -y -qq awscli >/dev/null
                  file="idenplane-$(date -u +%Y%m%dT%H%M%SZ).dump"
                  pg_dump --format=custom --file="/tmp/$file"
                  aws s3 cp "/tmp/$file" "s3://$BUCKET/idenplane/$file" --sse AES256
          volumes:
            - name: db-ca
              secret:
                secretName: idenplane-db-ca
```

Set the bucket's lifecycle rule to your retention, for example 30 daily copies and 12 monthly ones. Turn on object versioning or object lock so that a compromised server cannot delete its own backups. With Docker Compose, run the same commands from a host cron job, or use your provider's scheduled database backups.

**Check, at least every quarter:** restore the latest dump into a fresh database with `pg_restore --clean --if-exists --no-owner`. Start an Idenplane container against it, using the same webhook keys, and sign in. A backup you have never restored is unproven.

---

## 5. Before opening it to users

- [ ] `NODE_ENV=production`. The image sets it, and the server then refuses placeholder or short admin credentials.
- [ ] The `admin` account uses MFA, and day-to-day administrators sign in with their own accounts.
- [ ] `/console` and `/admin` are reachable only from your network or VPN, if your users don't need them.
- [ ] `WEB_CONCURRENCY=auto`, or several replicas, if one CPU is not enough; see [environment variables](../configuration/environment-variables.md).
- [ ] Metrics (`/metrics`) are scraped, and the readiness endpoint (`/health/ready`) is monitored, including its `redis.enabled` field when Redis is used.
- [ ] You know where the CHANGELOG's *Before you upgrade* notes are, and you take a backup before every upgrade ([Upgrading](upgrading.mdx)).
