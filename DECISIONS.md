# Technical Decision Log

This document records important architectural and technical decisions made during Idenplane development.

---

## 2026-05-04: Security Issues Resolution

### Decision: User Enumeration Prevention

**Context**: Multiple endpoints were exposing user existence information through error messages.

**Decision**: Standardize error messages to use generic responses regardless of whether the user exists.

**Consequences**:
- `sendVerificationEmail` returns same message for invalid email
- `validatePostLogoutRedirectUri` returns generic error
- All 404 responses use generic messages

**Related Issues**: #582, #583

---

## 2026-05-04: Token Introspection for Disabled Users

### Decision: Return `active: false` for disabled users without username

**Context**: Token introspection was returning `active: false` but still including username field, violating RFC 7662.

**Decision**: Return complete `{ active: false }` response immediately when user is disabled or deleted.

**Related Issues**: #614, #591

---

## 2026-05-04: Role Assignment User Verification

### Decision: Add user existence check to `assignClientRoles`

**Context**: `removeUserClientRoles` had user existence check but `assignClientRoles` did not.

**Decision**: Add consistent user existence verification to all role operations.

**Related Issues**: #617

---

## 2026-05-04: WebAuthn Realm Validation

### Decision: Validate user belongs to realm before generating authentication options

**Context**: `generateAuthenticationOptions` was accepting userId without verifying realm ownership.

**Decision**: Add user existence check with realm boundary validation.

**Related Issues**: #618

---

## 2026-05-04: MFA Step-Up for Admin Operations

### Decision: Require MFA step-up for critical admin operations

**Context**: Admin disabling user MFA should require additional verification.

**Decision**:
- API key auth blocked for MFA disable operations
- JWT session must have MFA ACR level verified
- Step-up verification required

**Related Issues**: #578, #577

---

## 2026-05-04: Admin Role Verification

### Decision: Add `RequireAdminRoles` decorator for critical realm operations

**Context**: Critical operations like realm deletion should require super-admin role.

**Decision**: Create `AdminRolesGuard` and `RequireAdminRoles` decorator to enforce role-based access for admin operations.

**Related Issues**: #577

---

## 2026-05-04: Session Revocation Race Condition

### Decision: Use `updateMany` instead of individual deletes in `revokeAllUserSessions`

**Context**: Previous implementation had race condition between finding sessions and deleting them.

**Decision**: Use atomic `updateMany` and `deleteMany` operations with proper where clauses.

**Related Issues**: #574

---

## 2026-05-04: Admin API Key Rate Limiting

### Decision: Add rate limiting for Admin API key authentication

**Context**: Static API key had no rate limiting protection.

**Decision**: Implement 15 requests/minute, 100 requests/hour limit for API key auth.

**Related Issues**: #575

---

## 2026-05-04: Impersonation Security

### Decision: Normalize API key adminUserId format with prefix

**Context**: API key impersonation sessions stored inconsistent actor identity.

**Decision**: Prefix API key actors with `api-key:` for consistent audit trail.

**Related Issues**: #573

---

## 2026-04-13: In-Memory Rate Limiting

### Decision: Document in-memory fallback behavior for multi-instance deployments

**Context**: When Redis unavailable, rate limiting uses per-instance memory.

**Decision**: This is documented behavior - distributed deployments require Redis for consistent rate limiting.

**Related Issues**: #581

---

## 2026-04-13: Backchannel Logout Error Handling

### Decision: Catch errors from backchannel logout to prevent unhandled rejections

**Context**: Fire-and-forget backchannel logout without error handling could cause issues.

**Decision**: Add `.catch()` handler for backchannel logout promises.

**Related Issues**: #594

---

## 2026-04-13: Token Revocation Input Validation

### Decision: Validate token is non-empty before processing revocation

**Context**: Empty token parameter could cause issues.

**Decision**: Return 400 BadRequest if token is empty or whitespace only.

**Related Issues**: #592

---

## 2026-04-13: Basic Auth URI Error Handling

### Decision: Wrap `decodeURIComponent` in try-catch

**Context**: Malformed URI encoding could throw URIError.

**Decision**: Wrap Basic auth decoding in try-catch to handle malformed input gracefully.

**Related Issues**: #593

---

## Architecture Decisions

### 2026-01-15: Prisma ORM for Database Access

**Decision**: Use Prisma ORM instead of raw SQL or query builder.

**Rationale**:
- Type-safe queries
- Migration management
- Easy database switching (PostgreSQL/MySQL/SQLite)

---

### 2025-11-20: Argon2id for Password Hashing

**Decision**: Use Argon2id for password hashing (RFC 9106).

**Rationale**:
- Memory-hard function resistant to GPU attacks
- Better than bcrypt for modern security requirements

---

### 2025-10-05: JWT RS256 Signing

**Decision**: Use RS256 (RSA + SHA-256) for JWT signing.

**Rationale**:
- Asymmetric - private key signs, public key verifies
- Better for multi-service architectures than HS256

---

### 2025-08-12: Redis for Caching and Sessions

**Decision**: Use Redis as optional cache layer.

**Rationale**:
- Improves performance for frequent lookups
- Enables horizontal scaling with session sharing
- Graceful fallback to in-memory when unavailable

---

## To Add Decisions

When making significant technical decisions:

1. Add entry with date, context, decision, and rationale
2. Include consequences (positive and negative)
3. Link to related GitHub issues or PRs
4. Update this document in the same PR as the change

