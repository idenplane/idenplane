# @idenplane/mcp

First-party MCP (Model Context Protocol) server for [Idenplane](https://idenplane.com) — manage identity in natural language from Claude Desktop, Claude Code, or Cursor.

## Tools

### Read tools
| Tool | Description |
|---|---|
| `list_realms` | List all realms |
| `get_realm` | Get realm details |
| `list_clients` | List OAuth2/OIDC clients in a realm |
| `list_users` | List users with search and pagination |
| `get_user` | Get a user by ID |
| `list_roles` | List realm roles |
| `list_active_sessions` | List active sessions (realm-wide or per user) |
| `query_audit_events` | Query login and admin audit events with filters |

### Write / destructive tools
| Tool | Description |
|---|---|
| `create_realm` | **[WRITE]** Create a new realm |
| `create_client` | **[WRITE]** Register a new OAuth2/OIDC client |
| `create_user` | **[WRITE]** Create a user |
| `set_user_roles` | **[WRITE]** Replace all realm roles for a user |
| `assign_role` | **[WRITE]** Add roles to a user (additive) |
| `revoke_session` | **[DESTRUCTIVE]** Terminate an active session |

## Configuration

The server reads two environment variables:

| Variable | Description |
|---|---|
| `IDENPLANE_URL` | Base URL of your Idenplane server (e.g. `http://localhost:3000`) |
| `IDENPLANE_ADMIN_TOKEN` | Admin API key (set in Idenplane as `ADMIN_API_KEY`) |

## Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "idenplane": {
      "command": "npx",
      "args": ["-y", "@idenplane/mcp"],
      "env": {
        "IDENPLANE_URL": "http://localhost:3000",
        "IDENPLANE_ADMIN_TOKEN": "your-admin-api-key"
      }
    }
  }
}
```

## Claude Code

Run once to register the server for this project:

```bash
claude mcp add idenplane \
  -e IDENPLANE_URL=http://localhost:3000 \
  -e IDENPLANE_ADMIN_TOKEN=your-admin-api-key \
  -- npx -y @idenplane/mcp
```

Or add it globally (available in all projects):

```bash
claude mcp add --scope user idenplane \
  -e IDENPLANE_URL=http://localhost:3000 \
  -e IDENPLANE_ADMIN_TOKEN=your-admin-api-key \
  -- npx -y @idenplane/mcp
```

## Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "idenplane": {
      "command": "npx",
      "args": ["-y", "@idenplane/mcp"],
      "env": {
        "IDENPLANE_URL": "http://localhost:3000",
        "IDENPLANE_ADMIN_TOKEN": "your-admin-api-key"
      }
    }
  }
}
```

## Local development

```bash
cd packages/idenplane-mcp
npm install
npm run build

# Run against a local Idenplane instance
IDENPLANE_URL=http://localhost:3000 \
IDENPLANE_ADMIN_TOKEN=dev-admin-key \
node dist/index.js
```

## Integration tests

Start Idenplane locally first (`docker compose up db -d && npm run start:dev` from the repo root), then:

```bash
cd packages/idenplane-mcp
npm install && npm run build

IDENPLANE_URL=http://localhost:3000 \
IDENPLANE_ADMIN_TOKEN=dev-admin-key \
npm test
```

The tests create a temporary realm, register a client and user, then verify audit events are recorded — and clean up the test realm afterward.
