<p align="center">
  <img src="https://idenplane.com/logo.svg" alt="Idenplane" width="60" />
</p>

<h2 align="center">idenplane</h2>

<p align="center">
  <strong>Official server-side Python SDK for <a href="https://idenplane.com">Idenplane</a></strong><br />
  <sub>OIDC discovery and admin user management against the Idenplane realm-management API.</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-blue" alt="v0.3.0" />
  <img src="https://img.shields.io/badge/python-3.9%2B-blue" alt="Python 3.9+" />
  <img src="https://img.shields.io/badge/typed-mypy_strict-success" alt="mypy strict" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

---

## Install

```bash
pip install idenplane
```

Requires Python 3.9 or newer. The only runtime dependency is `requests`.

---

## Quick start

```python
from idenplane import Client, Config

# Or: Config.from_env() — reads IDENPLANE_BASE_URL, IDENPLANE_REALM,
# IDENPLANE_ADMIN_TOKEN.
cfg = Config(
    base_url="https://auth.example.com",
    realm="my-realm",
    admin_token="eyJ...",  # service-account token with realm-management role
)

with Client(cfg) as client:
    # OIDC discovery (cached for 5 minutes by default)
    oidc = client.discovery.get()
    print(oidc["token_endpoint"])

    # Create a user
    user = client.users.create({
        "username": "alice",
        "email": "alice@example.com",
        "firstName": "Alice",
        "enabled": True,
    })
    print(user["id"])
```

---

## User CRUD

```python
from idenplane import Client, Config, ListUsersOptions

with Client(Config.from_env()) as client:
    # Read
    user = client.users.get("user-id-123")

    # List with filters and pagination (page is 1-based, limit defaults to 20)
    result = client.users.list(
        ListUsersOptions(page=1, limit=25, search="alice", enabled=True)
    )
    print(result["total"], "users")
    for u in result["users"]:
        print(u["username"])

    # Update
    user = client.users.update("user-id-123", {"email": "new@example.com"})

    # Reset password
    client.users.reset_password("user-id-123", "S3cret!", temporary=True)

    # Delete
    client.users.delete("user-id-123")
```

---

## Errors

All SDK errors inherit from `idenplane.IdenplaneError`. HTTP responses are
mapped to typed subclasses so callers can catch what they care about:

| Status | Exception            |
|--------|----------------------|
| 401/403 | `AuthError`         |
| 404    | `NotFoundError`      |
| 429    | `RateLimitError`     |
| 5xx    | `ServerError`        |
| other  | `IdenplaneError`     |

```python
from idenplane import Client, Config
from idenplane.exceptions import NotFoundError

with Client(Config.from_env()) as client:
    try:
        client.users.get("does-not-exist")
    except NotFoundError as exc:
        print("not found:", exc.status_code, exc.body)
```

---

## Discovery cache

`DiscoveryCache` is thread-safe and TTL-bounded (default 5 minutes). It is
exposed via `client.discovery.cache` for tests and advanced use:

```python
with Client(cfg) as client:
    client.discovery.get()              # network call
    client.discovery.get()              # cache hit
    client.discovery.invalidate()       # clear all realms
    client.discovery.refresh()          # forced refetch
```

---

## Development

```bash
git clone https://github.com/idenplane/idenplane.git
cd idenplane/packages/idenplane-python
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest -v
mypy idenplane
ruff check .
```

---

## License

MIT. See [LICENSE](./LICENSE).
