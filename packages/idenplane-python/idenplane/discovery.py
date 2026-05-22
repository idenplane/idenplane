"""OIDC discovery support.

Fetches and caches ``/realms/{realm}/.well-known/openid-configuration``
documents. The cache is thread-safe (uses a re-entrant lock) and applies
a TTL per realm. Mirrors the Go SDK's ``DiscoveryCache``.
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING, Optional

from typing_extensions import TypedDict

from idenplane.exceptions import IdenplaneError, _raise_for_status

if TYPE_CHECKING:
    from idenplane.client import Client


DEFAULT_TTL_SECONDS = 300.0  # 5 minutes


class OpenIDConfiguration(TypedDict, total=False):
    """OIDC discovery document.

    Only ``issuer``, ``authorization_endpoint``, ``token_endpoint``, and
    ``jwks_uri`` are required by the OIDC spec; the rest are optional and
    may be omitted by servers.
    """

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str
    jwks_uri: str
    end_session_endpoint: str
    introspection_endpoint: str
    registration_endpoint: str
    revocation_endpoint: str
    scopes_supported: list[str]
    response_types_supported: list[str]
    grant_types_supported: list[str]
    subject_types_supported: list[str]
    id_token_signing_alg_values_supported: list[str]
    token_endpoint_auth_methods_supported: list[str]


class _CacheEntry:
    """Internal cache entry pairing a config with its expiry timestamp."""

    __slots__ = ("config", "expires_at")

    def __init__(self, config: OpenIDConfiguration, expires_at: float) -> None:
        self.config = config
        self.expires_at = expires_at


class DiscoveryCache:
    """Thread-safe TTL cache for OIDC discovery documents, keyed by realm.

    Designed to mirror the Go SDK's ``DiscoveryCache``: returns a cached
    document while non-expired, lazily re-fetches on miss/expiry, and
    supports explicit invalidation of a single realm or the entire cache.
    """

    def __init__(self, *, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self._ttl_seconds = ttl_seconds
        self._entries: dict[str, _CacheEntry] = {}
        self._lock = threading.RLock()

    @property
    def ttl_seconds(self) -> float:
        """The TTL applied to entries on insertion."""
        return self._ttl_seconds

    def get_cached(self, realm: str) -> Optional[OpenIDConfiguration]:
        """Return the cached config for ``realm`` if present and not expired.

        Returns ``None`` on cache miss or expiry. Does NOT trigger a network
        fetch.
        """
        with self._lock:
            entry = self._entries.get(realm)
            if entry is None:
                return None
            if time.monotonic() >= entry.expires_at:
                # Stale entry; treat as miss but keep cleanup lazy.
                return None
            return entry.config

    def set(self, realm: str, config: OpenIDConfiguration) -> None:
        """Store ``config`` for ``realm`` and reset its TTL window."""
        with self._lock:
            self._entries[realm] = _CacheEntry(
                config=config,
                expires_at=time.monotonic() + self._ttl_seconds,
            )

    def invalidate(self, realm: Optional[str] = None) -> None:
        """Invalidate a single realm or the entire cache.

        When ``realm`` is ``None`` all entries are removed.
        """
        with self._lock:
            if realm is None:
                self._entries.clear()
            else:
                self._entries.pop(realm, None)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


class DiscoveryService:
    """OIDC discovery fetcher with an in-memory TTL cache.

    Built lazily by :class:`idenplane.Client`; reuses the client's session
    and timeout. The cache is shared across the service's lifetime; reset
    it via :meth:`invalidate`.
    """

    def __init__(
        self,
        client: Client,
        *,
        cache: Optional[DiscoveryCache] = None,
    ) -> None:
        self._client = client
        self._cache = cache if cache is not None else DiscoveryCache()

    @property
    def cache(self) -> DiscoveryCache:
        """Return the underlying cache (mainly for tests)."""
        return self._cache

    def _discovery_url(self, realm: str) -> str:
        return (
            f"{self._client.config.base_url_normalized()}"
            f"/realms/{realm}/.well-known/openid-configuration"
        )

    def get(self, realm: Optional[str] = None) -> OpenIDConfiguration:
        """Return the OIDC discovery document for ``realm``.

        When ``realm`` is omitted the client's configured realm is used.
        Reads from cache when possible; otherwise fetches over HTTP and
        populates the cache.

        Raises:
            IdenplaneError: On network failure or invalid JSON.
            ServerError, AuthError, NotFoundError, RateLimitError: For
                upstream HTTP failures.
        """
        target_realm = realm if realm is not None else self._client.config.realm

        cached = self._cache.get_cached(target_realm)
        if cached is not None:
            return cached

        return self._fetch(target_realm)

    def refresh(self, realm: Optional[str] = None) -> OpenIDConfiguration:
        """Force a network fetch, bypassing and refreshing the cache."""
        target_realm = realm if realm is not None else self._client.config.realm
        self._cache.invalidate(target_realm)
        return self._fetch(target_realm)

    def invalidate(self, realm: Optional[str] = None) -> None:
        """Invalidate one realm or all realms in the cache."""
        self._cache.invalidate(realm)

    def _fetch(self, realm: str) -> OpenIDConfiguration:
        url = self._discovery_url(realm)
        try:
            resp = self._client.session.get(
                url,
                headers=self._client.default_headers(),
                timeout=self._client.config.timeout_seconds,
            )
        except Exception as exc:
            raise IdenplaneError(f"discovery request failed: {exc}") from exc

        _raise_for_status(resp)

        try:
            data = resp.json()
        except ValueError as exc:
            raise IdenplaneError(
                f"discovery response was not valid JSON: {exc}",
                status_code=resp.status_code,
                body=resp.text,
            ) from exc

        if not isinstance(data, dict):
            raise IdenplaneError(
                "discovery response was not a JSON object",
                status_code=resp.status_code,
                body=resp.text,
            )

        config: OpenIDConfiguration = data  # type: ignore[assignment]
        self._cache.set(realm, config)
        return config
