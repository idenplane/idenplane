---
id: oauth
title: OAuth Endpoints
description: Authorization, UserInfo, and logout endpoints for Idenplane
---

# OAuth Endpoints

This section documents the OAuth 2.0 and OpenID Connect endpoints for authorization, user info retrieval, and logout.

## Authorization Endpoint

```
GET /realms/:realmName/protocol/openid-connect/auth
```

The authorization endpoint initiates the OAuth 2.0 authorization code flow. It redirects the user to authenticate and authorize the client application.

### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `client_id` | Yes | The client identifier |
| `redirect_uri` | Yes | The URI to redirect after authorization |
| `response_type` | Yes | Must be "code" for authorization code flow |
| `scope` | No | Space-separated list of scopes (default: "openid") |
| `state` | Recommended | CSRF protection token |
| `nonce` | Conditional | Required for implicit/hybrid flows, recommended for code |
| `code_challenge` | Conditional | Required for PKCE (S256 method) |
| `code_challenge_method` | Conditional | Must be "S256" when code_challenge provided |
| `prompt` | No | "none", "login", "consent", or "select_account" |
| `acr_values` | No | Requested ACR (e.g., "urn:mace:incommon:iap:silver") |
| `login_hint` | No | Username hint for pre-filling login form |

### Authorization Code Flow Example

```bash
# Direct user to authorization endpoint
https://localhost:3000/realms/master/protocol/openid-connect/auth \
  ?client_id=my-app \
  &redirect_uri=https://myapp.com/callback \
  &response_type=code \
  &scope=openid%20profile%20email \
  &state=xyz789 \
  &code_challenge=Kjcsjkk... \
  &code_challenge_method=S256
```

### Prompt Parameter

| Value | Description |
|-------|-------------|
| `none` | Do not display authentication UI; error if not authenticated |
| `login` | Force re-authentication even with existing session |
| `consent` | Force consent prompt even if previously granted |
| `select_account` | Allow user to select from available accounts |

### Response

Upon successful authorization, the user is redirected to the `redirect_uri` with an authorization code:

```
https://myapp.com/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz789
```

On error, the user is redirected to the `redirect_uri` with error parameters:

```
https://myapp.com/callback?error=access_denied&error_description=The+user+denied+the+request&state=xyz789
```

## UserInfo Endpoint

```
GET /realms/:realmName/protocol/openid-connect/userinfo
```

Returns claims about the authenticated user. Requires a valid access token with the `openid` scope.

### Request

```bash
curl -X GET "http://localhost:3000/realms/master/protocol/openid-connect/userinfo" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Response

```json
{
  "sub": "user-uuid-123",
  "preferred_username": "johndoe",
  "email": "johndoe@example.com",
  "email_verified": true,
  "given_name": "John",
  "family_name": "Doe",
  "name": "John Doe",
  "updated_at": 1620000000
}
```

### Standard Claims

| Claim | Description |
|-------|-------------|
| `sub` | Subject identifier (user UUID) |
| `preferred_username` | User's username |
| `email` | User's email address |
| `email_verified` | Whether email has been verified |
| `given_name` | User's first name |
| `family_name` | User's last name |
| `name` | User's full display name |
| `picture` | URL to user's profile picture |
| `updated_at` | Last update timestamp |

## Logout Endpoints

### Logout Endpoint

```
GET /realms/:realmName/protocol/openid-connect/logout
```

Initiates single logout (SLO) to terminate the user's session.

### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id_token_hint` | No | ID token for session identification |
| `post_logout_redirect_uri` | No | URI to redirect after logout |
| `state` | No | CSRF protection token |

### Request Example

```
GET /realms/master/protocol/openid-connect/logout \
  ?id_token_hint=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9... \
  &post_logout_redirect_uri=https://myapp.com \
  &state=xyz789
```

### Front-Channel Logout

```
GET /realms/:realmName/protocol/openid-connect/logout/frontchannel
```

Front-channel logout iframe forRP-initiated logout (OIDC Front-Channel Logout spec).

## OpenID Connect Discovery

```
GET /realms/:realmName/protocol/openid-connect/.well-known/openid-configuration
```

Returns the OpenID Connect discovery document with endpoint locations and capabilities.

### Response

```json
{
  "issuer": "http://localhost:3000/realms/master",
  "authorization_endpoint": "http://localhost:3000/realms/master/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/realms/master/protocol/openid-connect/token",
  "userinfo_endpoint": "http://localhost:3000/realms/master/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:3000/realms/master/protocol/openid-connect/certs",
  "revocation_endpoint": "http://localhost:3000/realms/master/protocol/openid-connect/token/revoke",
  "introspection_endpoint": "http://localhost:3000/realms/master/protocol/openoid-connect/token/introspect",
  "end_session_endpoint": "http://localhost:3000/realms/master/protocol/openid-connect/logout",
  "frontchannel_logout_supported": true,
  "frontchannel_logout_session_supported": true,
  "scopes_supported": ["openid", "profile", "email", "address", "phone"],
  "claims_supported": ["sub", "iss", "aud", "exp", "iat", "name", "preferred_username", "given_name", "family_name", "email", "email_verified"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "client_credentials", "refresh_token", "password"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256", "RS384", "RS512"],
  "code_challenge_method_supported": ["S256"],
  "request_parameter_supported": false,
  "request_uri_parameter_supported": false,
  "require_request_uri_registration": false,
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "private_key_jwt"],
  "device_authorization_endpoint": "http://localhost:3000/realms/master/protocol/openid-connect/device/code"
}
```

## JWKS Endpoint

```
GET /realms/:realmName/protocol/openid-connect/certs
```

Returns the public keys used to verify JWT signatures.

### Response

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "key-id-123",
      "alg": "RS256",
      "n": "0N5r... (base64url-encoded modulus)",
      "e": "AQAB (base64url-encoded exponent)"
    }
  ]
}
```

## Backchannel Logout

```
POST /realms/:realmName/protocol/openid-connect/logout/backchannel
```

OIDC Backchannel Logout endpoint for logout propagation to clients.

### Request Body

```json
{
  "logout_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Response

Returns HTTP 200 with empty body on success. Returns HTTP 400 for invalid logout tokens.

## Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | GET | Authorization endpoint |
| `/token` | POST | Token endpoint |
| `/userinfo` | GET | UserInfo endpoint |
| `/logout` | GET/POST | Logout endpoint |
| `/logout/frontchannel` | GET | Front-channel logout |
| `/logout/backchannel` | POST | Back-channel logout |
| `/.well-known/openid-configuration` | GET | Discovery document |
| `/certs` | GET | JSON Web Key Set |
