# Sentinel Journal

## 2026-08-01 - Idempotency in Impersonation Session Termination
**Vulnerability:** The impersonation session termination endpoint (`/admin/realms/:realmName/impersonation/end`) previously threw a `BadRequestException` when requested to end a session that was already inactive. This lack of idempotency exposed an error message and status code (400) when the endpoint was called on a closed session, which could leak state or create unnecessary operational noise/errors for client integrations.
**Learning:** Security APIs that modify session state (such as revocation or termination) should behave idempotently. Returning success (e.g. 204 No Content or 200 OK) for an already-inactive resource prevents timing side-channels and state-leakage while minimizing operational integration errors.
**Prevention:** Always design session/credential destruction, revocation, and termination endpoints to be idempotent. If the target state is already reached, return successfully rather than throwing a bad request error.
