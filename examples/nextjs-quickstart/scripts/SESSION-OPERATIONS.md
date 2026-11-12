# Dedicated session database operations

This tool supports PostgreSQL 16 and a dedicated database whose sole user
relation is `public.bff_sessions`. It does not back up users, realms, clients or
the identity-provider database. The maintenance image installs no npm packages.

## Local scheduled cleanup

After the existing server-session setup, add the local operations overlay:

```sh
docker compose --env-file .env.server-session -f docker-compose.yml -f compose.server-session.yml -f compose.session-ops.yml up -d --build
```

The additional `session-cleaner` runs every 300 seconds, deletes at most 20
batches of 500 expired/idle-expired rows, skips locked rows and reports counts
without credentials. Health fails after a failed pass or a stale status. The
service retries, recovers after database repair, and handles SIGTERM. Failure of
the cleaner does not authorize expired sessions; request authorization still
enforces expiry in PostgreSQL.

The overlay is local-only: it explicitly permits plaintext database traffic and
uses the demo database owner. It has no published ports or session/backup keys,
and runs non-root with a read-only filesystem. Production should use verified
TLS, health alerts and a dedicated role with these tested grants (create its
password through your secret manager):

```sql
GRANT CONNECT ON DATABASE bff TO bff_cleaner;
GRANT USAGE ON SCHEMA public TO bff_cleaner;
GRANT SELECT, DELETE ON public.bff_sessions TO bff_cleaner;
GRANT UPDATE (sid_hash) ON public.bff_sessions TO bff_cleaner;
```

The single-column UPDATE grant is required by PostgreSQL row locking. This role
cannot insert sessions or change encrypted payloads. These grants alone do not
provision production credentials or scheduling.

## Encrypted backups

Build the image and generate a separate backup key without overwriting a file:

```sh
docker build -f Dockerfile.session-ops -t idenplane-session-ops:local .
node scripts/session-maintenance.mjs keygen --output .env.session-backup
```

Preserve the generated `SESSION_BACKUP_KEY` and the original
`SESSION_ENCRYPTION_KEY` independently in a secret manager. Neither is stored in
the archive. Losing the backup key prevents opening its archive; losing the
session key prevents decrypting session payloads. Key rotation/key rings are
not implemented. Keep private backup configuration and archives outside Git.

Use a private environment file outside the repository:

```dotenv
PGHOST=your-session-database-host
PGPORT=5432
PGDATABASE=bff
PGUSER=your-backup-role
PGSSLMODE=verify-full
PGSSLROOTCERT=/run/secrets/database-ca.pem
PGPASSWORD_FILE=/run/secrets/database-password
SESSION_ENCRYPTION_KEY=<existing 64-hex application key>
SESSION_BACKUP_KEY=<independent 64-hex backup key>
```

Mount secret files read-only and provision directory permissions for container
UID 1000. PostgreSQL tools receive a private temporary 0600 pgpass file, with no
password on the command line and no application keys in their environment.
`PGPASSWORD` is not accepted. `SESSION_POSTGRES_PASSWORD` supports the local demo.
Only `PGSSLMODE=disable` plus `SESSION_OPS_ALLOW_INSECURE=true` permits non-TLS
fixture access. Attach to the database's private Docker network as appropriate.

Adapt the absolute paths/network placeholders to the actual deployment:

```sh
docker run --rm --network YOUR_PRIVATE_NETWORK --env-file /PRIVATE/ops.env \
  --mount type=bind,source=/PRIVATE/secrets,target=/run/secrets,readonly \
  --mount type=bind,source=/PRIVATE/backups,target=/backups \
  idenplane-session-ops:local backup --output /backups/NEW_SNAPSHOT_NAME
```

The output directory must be new. It contains `archive.enc` (AES-256-GCM,
fresh nonce) and `manifest.json` (format, checksum, session-key fingerprint).
Before the dump, the supplied session key is checked against up to ten source
rows when available. This sanity check is not exhaustive validation of all data.
`pg_dump -Fc` creates a consistent single-table snapshot. Raw archives exist on
the container's temporary work filesystem and are removed afterward. Provision
enough private work capacity; the cleaner's 64 MiB tmpfs is not a backup sizing
recommendation. Define off-host storage, retention, RPO/RTO, scheduling and key
recovery for production; no retention deletion or off-host upload runs here.

## Safe recovery: users sign in again

Restore only your own trusted backups into a new empty dedicated database.
PostgreSQL archives contain executable restore SQL. Keep the target disconnected
from app traffic until success. In a separate recovery environment file, point
the connection at that empty target and preserve the original keys:

```sh
docker run --rm --network YOUR_PRIVATE_NETWORK --env-file /PRIVATE/recovery.env \
  --mount type=bind,source=/PRIVATE/secrets,target=/run/secrets,readonly \
  --mount type=bind,source=/PRIVATE/backups,target=/backups,readonly \
  idenplane-session-ops:local restore --input /backups/SNAPSHOT_NAME
```

The entire archive is authenticated/decrypted before restore SQL. The tool
checks target emptiness and the original key fingerprint, restores the schema
and data, then removes all sessions/login transactions **in the same database
transaction**. SQL failure rolls it back. Success exposes a working schema with
zero old sessions; new logins create fresh sessions. There is no CLI option to
keep restored sessions. Do not reconnect the old database as an active worker
after cutover; manage its access separately.

A raw restore can resurrect a copied cookie revoked after the snapshot. The
integration test demonstrates this only in an isolated disposable quarantine
to verify encrypted-data recovery. Normal recovery always invalidates it.

## Verification

With Node.js 24, example dependencies and Docker:

```sh
node --experimental-strip-types --test tests/*.test.mjs
node --experimental-strip-types tests/session-operations.integration.mjs
```

The runner builds the current image, uses fresh databases/generated secrets,
and removes its keys, archives, databases and containers. Sanitized result JSON
and image-build logs go to `SESSION_TEST_ARTIFACTS`. The GitHub session workflow
includes it; local passes do not mean GitHub or production has run it.

References: [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html),
[password configuration](https://www.postgresql.org/docs/16/libpq-envars.html),
[row locking privileges](https://www.postgresql.org/docs/16/sql-select.html).
