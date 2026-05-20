---
id: users
title: Users API
description: User management endpoints for Idenplane
---

# Users API

The Users API provides endpoints for managing users within a realm. All endpoints require API key authentication.

## Base URL

```
/admin/realms/:realmName/users
```

## List Users

```
GET /admin/realms/:realmName/users
```

Returns a paginated list of users in the realm.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `limit` | integer | 20 | Users per page (max 100) |
| `search` | string | - | Free-text search across username, email, firstName, lastName |
| `username` | string | - | Filter by username (case-insensitive contains) |
| `email` | string | - | Filter by email (case-insensitive contains) |
| `firstName` | string | - | Filter by first name |
| `lastName` | string | - | Filter by last name |

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/users?page=1&limit=20&search=john" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "data": [
    {
      "id": "user-uuid-123",
      "username": "johndoe",
      "email": "johndoe@example.com",
      "emailVerified": true,
      "firstName": "John",
      "lastName": "Doe",
      "enabled": true,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-20T14:22:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

## Create User

```
POST /admin/realms/:realmName/users
```

Creates a new user in the realm.

### Request Body

| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `username` | string | Yes | Unique username |
| `email` | string | Yes | User's email address |
| `firstName` | string | No | User's first name |
| `lastName` | string | No | User's last name |
| `enabled` | boolean | No | Whether user is enabled (default: true) |
| `emailVerified` | boolean | No | Email is verified (default: false) |
| `password` | string | No | Initial password |

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/master/users" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "janedoe",
    "email": "janedoe@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "password": "securePassword123"
  }'
```

### Response

```json
{
  "id": "user-uuid-456",
  "username": "janedoe",
  "email": "janedoe@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "enabled": true,
  "emailVerified": false,
  "createdAt": "2024-02-01T09:00:00Z",
  "updatedAt": "2024-02-01T09:00:00Z"
}
```

## Get User

```
GET /admin/realms/:realmName/users/:userId
```

Returns a single user by ID.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/users/user-uuid-456" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "id": "user-uuid-456",
  "username": "janedoe",
  "email": "janedoe@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "enabled": true,
  "emailVerified": false,
  "createdAt": "2024-02-01T09:00:00Z",
  "updatedAt": "2024-02-01T09:00:00Z"
}
```

## Update User

```
PUT /admin/realms/:realmName/users/:userId
```

Updates an existing user. Replaces all mutable fields.

### Request Body

```json
{
  "username": "janedoe",
  "email": "janedoe@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "enabled": true,
  "emailVerified": true
}
```

### Request Example

```bash
curl -X PUT "http://localhost:3000/admin/realms/master/users/user-uuid-456" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "janedoe",
    "email": "janedoe@example.com",
    "firstName": "Jane",
    "lastName": "Doe"
  }'
```

## Partial Update User

```
PATCH /admin/realms/:realmName/users/:userId
```

Partially updates a user. Only provided fields are updated.

```bash
curl -X PATCH "http://localhost:3000/admin/realms/master/users/user-uuid-456" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Jane Elizabeth"
  }'
```

## Delete User

```
DELETE /admin/realms/:realmName/users/:userId
```

Permanently deletes a user and all associated data.

### Request Example

```bash
curl -X DELETE "http://localhost:3000/admin/realms/master/users/user-uuid-456" \
  -H "X-API-Key: your-api-key-here"
```

### Response

Returns HTTP 204 No Content on success.

## Reset Password

```
PUT /admin/realms/:realmName/users/:userId/reset-password
```

Sets or resets a user's password.

### Request Body

| Field | Type | Required | Description |
|-------|------|---------|-------------|
| `password` | string | Yes | New password |
| `temporary` | boolean | No | Force user to change password on next login |

### Request Example

```bash
curl -X PUT "http://localhost:3000/admin/realms/master/users/user-uuid-456/reset-password" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "newSecurePassword123",
    "temporary": true
  }'
```

### Response

Returns HTTP 204 No Content on success.

## Send Verification Email

```
POST /admin/realms/:realmName/users/:userId/send-verification-email
```

Sends or resends email verification to a user.

### Request Example

```bash
curl -X POST "http://localhost:3000/admin/realms/master/users/user-uuid-456/send-verification-email" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "message": "Verification email sent"
}
```

## List Offline Sessions

```
GET /admin/realms/:realmName/users/:userId/offline-sessions
```

Lists all offline sessions for a user.

### Request Example

```bash
curl -X GET "http://localhost:3000/admin/realms/master/users/user-uuid-456/offline-sessions" \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "data": [
    {
      "tokenId": "token-uuid-789",
      "clientId": "my-app",
      "createdAt": "2024-02-01T10:00:00Z",
      "lastRefresh": "2024-02-15T08:30:00Z",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0..."
    }
  ]
}
```

## Revoke Offline Session

```
DELETE /admin/realms/:realmName/users/:userId/offline-sessions/:tokenId
```

Revokes a specific offline session.

### Request Example

```bash
curl -X DELETE "http://localhost:3000/admin/realms/master/users/user-uuid-456/offline-sessions/token-uuid-789" \
  -H "X-API-Key: your-api-key-here"
```

### Response

Returns HTTP 204 No Content on success.

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `ValidationError` | Invalid request body or parameters |
| 401 | `Unauthorized` | Missing or invalid API key |
| 404 | `NotFound` | User not found |
| 409 | `Conflict` | Username or email already exists |

## User Object Schema

```json
{
  "id": "string (UUID)",
  "username": "string",
  "email": "string",
  "emailVerified": "boolean",
  "firstName": "string",
  "lastName": "string",
  "enabled": "boolean",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)",
  "attributes": "object (custom attributes)",
  "groups": "string[]",
  "roles": "string[]"
}
```
