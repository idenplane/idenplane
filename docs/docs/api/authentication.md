---
id: authentication
title: Authentication API
description: OAuth 2.0 and OpenID Connect token endpoints for Idenplane
---

# Authentication API

The Authentication API provides OAuth 2.0 and OpenID Connect token endpoints. All authentication flows use this API to obtain access tokens, refresh tokens, and ID tokens.

## Token Endpoint

```
POST /realms/:realmName/protocol/openid-connect/token
```

The token endpoint is the central OAuth 2.0 endpoint that handles all grant types. It supports both `application/json` and `application/x-www-form-urlencoded` content types.

### Request Parameters

The following parameters are supported based on the grant type:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `grant_type` | Yes | The OAuth grant type |
| `client_id` | Yes | The client identifier |
| `client_secret` | Conditional | Required for confidential clients |
| `username` | Conditional | Required for password grant |
| `password` | Conditional | Required for password grant |
| `code` | Conditional | Required for authorization_code grant |
| `redirect_uri` | Conditional | Required for authorization_code grant |
| `code_verifier` | Conditional | Required for PKCE authorization_code |
| `refresh_token` | Conditional | Required for refresh_token grant |
| `scope` | No | Space-separated list of requested scopes |
| `device_code` | Conditional | Required for device_code grant |
| `acr_values` | No | Requested Authentication Context Class Reference |

### Grant Types

#### Authorization Code Grant

```bash
curl -X POST "http://localhost:3000/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=my-app" \
  -d "code=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d "redirect_uri=https://myapp.com/callback" \
  -d "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "refresh_token": "rt_8xq2k3j5h7...",
  "token_type": "Bearer",
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "scope": "openid profile email"
}
```

#### Client Credentials Grant

```bash
curl -X POST "http://localhost:3000/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=my-service" \
  -d "client_secret=secret123" \
  -d "scope=read write"
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "token_type": "Bearer",
  "scope": "read write"
}
```

#### Resource Owner Password Credentials Grant

:::caution Deprecation Notice
The password grant is deprecated by OAuth 2.1 and will be removed in a future release. Please migrate to the authorization_code grant with PKCE.
:::

```bash
curl -X POST "http://localhost:3000/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=my-app" \
  -d "client_secret=secret123" \
  -d "username=user@example.com" \
  -d "password=secretpassword" \
  -d "scope=openid profile email"
```

#### Refresh Token Grant

```bash
curl -X POST "http://localhost:3000/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "client_id=my-app" \
  -d "refresh_token=rt_8xq2k3j5h7..."
```

### Error Responses

| Error | Description |
|-------|-------------|
| `invalid_request` | Missing or invalid parameter |
| `invalid_client` | Client authentication failed |
| `invalid_grant` | Invalid authorization code or refresh token |
| `unauthorized_client` | Client not authorized for this grant type |
| `unsupported_grant_type` | Grant type not supported |
| `authorization_pending` | Device code flow - authorization pending |
| `slow_down` | Device code flow - polling too fast |

**Error Response Format:**

```json
{
  "error": "invalid_grant",
  "error_description": "The authorization code has expired"
}
```

When a user has MFA, the password grant answers `mfa_required` with an `mfa_token`; the client then sends the code with the `mfa_otp` grant. See [MFA](../guides/mfa.mdx).

### Response Headers

The token endpoint sets cache control headers as required by RFC 6749:

```http
Cache-Control: no-store
Pragma: no-cache
```

For deprecated password grant:

```http
Deprecation: true
Warning: 299 - "The OAuth 2.0 password grant is deprecated..."
```

## Token Response Fields

| Field | Description |
|-------|-------------|
| `access_token` | JWT access token for API authorization |
| `token_type` | Token type (always "Bearer") |
| `expires_in` | Token lifetime in seconds |
| `refresh_token` | Token for obtaining new access tokens |
| `id_token` | OpenID Connect ID token (when openid scope requested) |
| `scope` | Granted scopes (may differ from requested) |

## Token Introspection

```
POST /realms/:realmName/protocol/openid-connect/token/introspect
```

Validate and introspect tokens. The caller must authenticate as a client: a confidential client with its secret (or HTTP Basic or a client certificate), a public client with its `client_id`. Without it the response is `401`.

```bash
curl -X POST "http://localhost:3000/realms/master/protocol/openid-connect/token/introspect" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=my-app" \
  -d "client_secret=my-app-secret" \
  -d "token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d "token_type_hint=access_token"
```

**Response (active token):**

```json
{
  "active": true,
  "sub": "user-uuid-123",
  "client_id": "my-app",
  "exp": 1620000000,
  "iat": 1619999700,
  "scope": "openid profile email"
}
```

**Response (inactive token):**

```json
{
  "active": false
}
```

## Revocation

```
POST /realms/:realmName/protocol/openid-connect/revoke
```

Revoke an access or refresh token. The caller authenticates as a client, as for introspection:

```bash
curl -X POST "http://localhost:3000/realms/master/protocol/openid-connect/revoke" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=my-app" \
  -d "client_secret=my-app-secret" \
  -d "token=rt_8xq2k3j5h7..." \
  -d "token_type_hint=refresh_token"
```

**Response:** HTTP 200 for a revoked or unknown token (RFC 7009). A token that was issued to a different client gets `403` with `{"error": "access_denied"}`, and a request without `token` gets `400`.

## Device Authorization Grant

For device code flow (RFC 8628), the device authorization endpoint is used to obtain device and user codes:

```
POST /realms/:realmName/protocol/openid-connect/auth/device
```

A confidential client authenticates here as at the token endpoint (secret, HTTP Basic or client certificate); a public client sends only its `client_id`.

```bash
curl -X POST "http://localhost:3000/realms/master/protocol/openid-connect/auth/device" \
  -d "client_id=my-app" \
  -d "client_secret=my-app-secret"
```

**Response:**

```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS...",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://auth.example.com/realms/master/device",
  "verification_uri_complete": "https://auth.example.com/realms/master/device?user_code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5
}
```

The client then polls the token endpoint with the device_code until authorization is complete.
