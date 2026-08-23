# Forward Auth with Traefik

Idenplane protecting an application that knows nothing about it.

The protected app here is [`traefik/whoami`](https://hub.docker.com/r/traefik/whoami) — a container whose entire job is to echo back the HTTP headers it received. No SDK, no config, no OIDC. That is the demo: you will see your identity in its output, put there by Idenplane at the proxy.

## Run it

```bash
docker compose up
```

Then open **http://app.localhost** and sign in as `demo` / `demo1234`.

`*.localhost` resolves to `127.0.0.1` in every modern browser, so this works with no `/etc/hosts` edits.

## What you should see

Before signing in you land on Idenplane's login page. After signing in, whoami prints something like:

```
Hostname: 6f2c1b0e5a4d
IP: 172.20.0.6
...
X-Forwarded-User: demo
X-Forwarded-Email: demo@example.com
X-Forwarded-Preferred-Username: Demo User
X-Forwarded-Groups:
```

Those four headers are the whole feature. whoami did nothing to get them.

## What the stack is doing

```
browser → traefik → (forwardauth) → idenplane /realms/demo/proxy/whoami/verify
                 ↘ 200 + headers ↙
                    whoami (unmodified)
```

| service | role |
|---|---|
| `traefik` | routes `app.localhost` and `auth.localhost`, calls forward auth |
| `idenplane` | login, sessions, the `verify` endpoint |
| `db` | Postgres |
| `seed` | one-shot: creates the realm, client, user and proxy application |
| `app` | `traefik/whoami` — the thing being protected |

## Two lines that carry the whole thing

**In `docker-compose.yml`, on the `app` service:**

```yaml
- 'traefik.http.middlewares.idenplane-auth.forwardauth.authResponseHeaders=X-Forwarded-User,...'
```

Traefik only copies headers you name here from the auth response to the upstream request. Leave it out and authentication works perfectly while the application sees nobody — a confusing half-working state.

**In `seed.sh`, on the proxy application:**

```json
"cookieDomain": ".localhost"
```

The browser has to send one cookie to both `auth.localhost` and `app.localhost`. Scope it to either host alone and you get an infinite redirect loop with nothing in any log. Idenplane refuses that combination at creation time, which is why you cannot accidentally ship it.

## Things to try

**Sign out of the app but stay signed in to Idenplane:**

```
http://auth.localhost/realms/demo/proxy/whoami/sign-out
```

Reload `app.localhost` — you are let straight back in, because the SSO session is untouched. That is the difference between signing out of an application and signing out of the identity provider.

**Kick everyone out:**

```bash
curl -X POST http://auth.localhost/admin/realms/demo/proxy-applications/whoami/revoke-sessions \
  -H 'x-admin-api-key: forward-auth-demo-admin-key-do-not-use-in-production'
```

**Turn on MFA** for the realm in the console at http://auth.localhost/console, then sign out and back in. Nothing about the proxy configuration changes — forward auth runs through the ordinary login flow, so it picks up MFA, step-up and consent for free.

## Not production configuration

The secrets in `docker-compose.yml` are fixed and public, everything is plain HTTP, and the proxy session cookie is sent with `Secure` — which browsers accept on `localhost` as a secure context but will not on a plain-HTTP domain. For anything real, terminate TLS at the proxy and generate your own secrets.

See the [Forward Auth guide](https://idenplane.com/docs/guides/forward-auth) for nginx and Caddy configurations and the full reference.
