<p align="center">
  <img src="https://idenplane.com/logo.svg" alt="Idenplane" width="60" />
</p>

<h2 align="center">idenplane-cli</h2>

<p align="center">
  <strong>Official CLI for <a href="https://idenplane.com">Idenplane</a></strong><br />
  <sub>Manage realms, clients, users, roles, and groups on an Idenplane server from the terminal.</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/idenplane-cli?label=idenplane-cli" alt="npm idenplane-cli" />
  <img src="https://img.shields.io/badge/node-18%2B-339933" alt="Node 18+" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

---

## Install

```bash
npm install -g idenplane-cli
```

Requires Node.js 18 or newer. Installs a single `idenplane` binary.

---

## Authenticate

```bash
idenplane login --server https://auth.example.com
```

Prompts for username/password (or pass `--username`/`--password`), or authenticate with a static admin API key instead:

```bash
idenplane login --server https://auth.example.com --api-key <admin-api-key>
```

Credentials are saved to `~/.idenplane/config.json`, encrypted at rest (AES-256-GCM). Inspect or verify the saved config:

```bash
idenplane config show       # server URL and masked credentials
idenplane config validate   # checks the server is reachable and credentials are valid
idenplane whoami            # current authenticated identity
idenplane logout            # clear saved credentials
```

### Environment variables (CI / scripting)

As an alternative to `idenplane login`, set a server URL together with either an API key or a bearer token — no config file is written:

```bash
export IDENPLANE_SERVER_URL=https://auth.example.com
export ADMIN_API_KEY=<admin-api-key>
# — or —
export IDENPLANE_TOKEN=<bearer-token>
```

Every command accepts `--json` to print machine-readable output instead of a table.

---

## Command reference

### `idenplane realm`

| Command | Description |
|---|---|
| `realm list` | List all realms |
| `realm create <name>` | Create a new realm |
| `realm get <name>` | Get realm details |
| `realm update <name>` | Update a realm |
| `realm delete <name>` | Delete a realm |
| `realm export <name>` | Export a realm to a JSON file |
| `realm import <file>` | Import a realm from a JSON file |

### `idenplane client`

| Command | Description |
|---|---|
| `client list --realm <realm>` | List clients in a realm |
| `client create <clientId>` | Create a client |
| `client get <clientId>` | Get client details |
| `client update <clientId>` | Update a client |
| `client delete <clientId>` | Delete a client |
| `client rotate-secret <clientId>` | Rotate the client secret for a CONFIDENTIAL client |

### `idenplane user`

| Command | Description |
|---|---|
| `user list --realm <realm>` | List users in a realm |
| `user create <username>` | Create a user |
| `user get <id>` | Get a user by ID |
| `user update <id>` | Update a user |
| `user delete <id>` | Delete a user |
| `user set-password <id>` | Set a user's password |
| `user bulk-import` | Import users from a CSV or JSON file |

### `idenplane role`

| Command | Description |
|---|---|
| `role list --realm <realm>` | List realm roles |
| `role create <name>` | Create a realm role |
| `role get <name>` | Get role details |
| `role update <name>` | Update a realm role |
| `role delete <name>` | Delete a realm role |
| `role assign <userId> <roleName>` | Assign a realm role to a user |
| `role unassign <userId> <roleName>` | Remove a realm role from a user (`role remove` is an alias) |

### `idenplane group`

| Command | Description |
|---|---|
| `group list --realm <realm>` | List groups in a realm |
| `group create <name>` | Create a group |
| `group get <id>` | Get group details |
| `group update <id>` | Update a group |
| `group delete <id>` | Delete a group |

### Other commands

| Command | Description |
|---|---|
| `init` | Interactive setup: connect, create a realm, client, and roles |
| `migrate keycloak` | Import from a Keycloak realm export JSON |
| `migrate auth0` | Import from an Auth0 Management API export |
| `migrate zitadel` | Import from a hand-assembled Zitadel Management API export |
| `upgrade` | Run pre-flight checks then apply database migrations |
| `upgrade:status` | View upgrade audit history |
| `completion <shell>` | Output a shell completion script (bash, zsh, fish) |

Run `idenplane <command> --help` for the full option list of any command.

---

## Development

```bash
git clone https://github.com/idenplane/idenplane.git
cd idenplane/packages/idenplane-cli
npm install
npm run build
npm run typecheck
npm test
```

---

## License

MIT. See [LICENSE](./LICENSE).
