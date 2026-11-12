# Server session integration checks

Run with Node.js 24 and a running local Docker daemon. Each check creates fresh
labelled PostgreSQL containers and deletes its own containers and volumes in
`finally`. It never connects to a pre-existing database. No account secrets are
required; all client and database credentials belong to the disposable fixture.

From the repository root:

```sh
npm ci --prefix examples/nextjs-quickstart
node --experimental-strip-types examples/nextjs-quickstart/tests/session-store.integration.mjs
npm ci --prefix packages/idenplane-js
npm run build --prefix packages/idenplane-js
npm ci --prefix admin-ui
cd admin-ui
npx playwright install chromium
cd ..
docker build -t idenplane:session-ci .
node --experimental-strip-types examples/nextjs-quickstart/tests/session-runtime.mjs
```

`IDENPLANE_TEST_IMAGE` selects an already-built backend image (default
`idenplane:session-ci`). `SESSION_TEST_ARTIFACTS` selects an artifact directory;
the default is `idenplane-session-evidence` under the operating system temp
directory. Results JSON, a build log and a screenshot can be shared. Do not
upload build contexts or container inspection output: temporary credentials can
exist in running fixture environments. A forcibly interrupted process may leave
its labelled fixture containers behind; inspect ownership before removing them.

The SQL check verifies encryption, row-bound ciphertext, one-time login state,
expiry, rollback, concurrent refresh and immediate revocation. The browser check
builds the current example with the current SDK dist, runs a real confidential
OIDC login against the selected backend, and checks two independent Next.js
workers sharing PostgreSQL, a worker restart, refresh rotation, user isolation,
CSRF rejection, logout, copied-cookie rejection and database outage handling.

The disposable browser fixture uses the explicit loopback HTTP development
exception. It does not establish production HTTPS or cross-domain SSO readiness.
The GitHub workflow `.github/workflows/server-session.yml` runs these commands
on Linux and uploads only the selected verification artifacts. A local pass
does not mean a GitHub-hosted run has occurred.

For the HTTPS fixture, set `SESSION_TEST_HTTPS=true` and run the same runtime
command. Use a separate `SESSION_TEST_ARTIFACTS` directory to retain both runs.
It creates a one-day private CA and a TLS certificate in a private temporary
directory. Caddy publishes only loopback ports; Chromium resolves
`app.idenplane.test` and `login.idenplane.test` to loopback for that test process.
Node requests and the Next.js server validate the fixture CA and hostname.
The browser uses an SPKI exception limited to the fresh fixture key; it does
not test public certificate issuance, browser trust from a public CA, or domain
ownership. The system trust store and hosts file are untouched. The fixture
deletes its certificate files and containers when it finishes.

The HTTPS run disables the HTTP development exception, checks the actual
`__Host-idenplane_session` cookie, verifies it is absent on the identity-provider
hostname and plain HTTP, and repeats the login, refresh and revocation checks.
The two test domains share the same registrable site. SSO across unrelated
registrable domains remains a separate deployment test.

For encrypted backup/restore and automatic cleanup checks, run
`node --experimental-strip-types examples/nextjs-quickstart/tests/session-operations.integration.mjs`
from the repository root. See [session operations](../scripts/SESSION-OPERATIONS.md)
for the local cleanup overlay, private backup configuration and safe recovery
policy. Normal restore invalidates all backed-up sessions before commit.
