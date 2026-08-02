"""Client and Config types for the Idenplane SDK.

The :class:`Client` is the entry point. It holds an immutable :class:`Config`
and a single ``requests.Session`` that is reused across services for
keep-alive performance. Service objects (``users``, ``discovery``, ``roles``, ``groups``) are
lazily instantiated on first access.
"""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field
from types import TracebackType
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urlparse

import requests

from idenplane.exceptions import IdenplaneError, _raise_for_status

if TYPE_CHECKING:
    from idenplane.discovery import DiscoveryService
    from idenplane.groups import GroupService
    from idenplane.roles import RoleService
    from idenplane.users import UserService

_USER_AGENT = "idenplane-python/0.3.0"
_DEFAULT_TIMEOUT_SECONDS = 30.0


def _is_loopback_host(host: Optional[str]) -> bool:
    """Return whether host is localhost or a loopback IP literal."""
    if host is None:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True)
class Config:
    """Immutable configuration for an Idenplane :class:`Client`.

    Attributes:
        base_url: Base URL of the Idenplane server, e.g. ``https://auth.example.com``.
            A trailing slash is stripped automatically via :meth:`base_url_normalized`.
        realm: Realm name to operate against.
        admin_token: Bearer token for admin API calls. When ``None`` the
            ``Authorization`` header is omitted (useful for public discovery).
        timeout_seconds: HTTP request timeout in seconds. Defaults to 30s.
        user_agent: Value sent in the ``User-Agent`` header.
        allow_insecure_http: Allow ``base_url`` to use ``http://`` for a
            non-loopback host (default: ``False``). Loopback hosts
            (``localhost``, ``127.0.0.1``, ``::1``) are always permitted over
            ``http://`` since local development has no TLS to offer.
            Anywhere else, plaintext HTTP would send the admin token over the
            wire unencrypted, so construction fails unless this is set.
    """

    base_url: str
    realm: str
    admin_token: Optional[str] = None
    timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS
    user_agent: str = _USER_AGENT
    extra_headers: dict[str, str] = field(default_factory=dict)
    allow_insecure_http: bool = False

    def __post_init__(self) -> None:
        if not self.base_url:
            raise ValueError("Config.base_url is required")
        if not self.realm:
            raise ValueError("Config.realm is required")
        if self.timeout_seconds <= 0:
            raise ValueError("Config.timeout_seconds must be positive")
        self._validate_url_scheme()

    def _validate_url_scheme(self) -> None:
        parsed = urlparse(self.base_url)
        if parsed.scheme == "https":
            return
        if parsed.scheme == "http":
            if self.allow_insecure_http or _is_loopback_host(parsed.hostname):
                return
            raise ValueError(
                'Config.base_url uses insecure "http://"; use "https://" or '
                "set allow_insecure_http=True if this is intentional"
            )
        raise ValueError(
            f'Config.base_url must use "https://" (got "{parsed.scheme}://" in {self.base_url!r})'
        )

    @classmethod
    def from_env(cls) -> Config:
        """Build a :class:`Config` from environment variables.

        Reads ``IDENPLANE_BASE_URL``, ``IDENPLANE_REALM``, and
        ``IDENPLANE_ADMIN_TOKEN``. The first two are required; the admin
        token is optional.

        Raises:
            ValueError: If either ``IDENPLANE_BASE_URL`` or
                ``IDENPLANE_REALM`` is missing or empty.
        """
        base_url = os.environ.get("IDENPLANE_BASE_URL", "").strip()
        realm = os.environ.get("IDENPLANE_REALM", "").strip()
        admin_token = os.environ.get("IDENPLANE_ADMIN_TOKEN", "").strip() or None

        if not base_url:
            raise ValueError("IDENPLANE_BASE_URL is required but not set")
        if not realm:
            raise ValueError("IDENPLANE_REALM is required but not set")

        return cls(
            base_url=base_url,
            realm=realm,
            admin_token=admin_token,
        )

    def base_url_normalized(self) -> str:
        """Return :attr:`base_url` with any trailing slash removed."""
        return self.base_url.rstrip("/")


class Client:
    """Thread-safe client for the Idenplane admin API.

    The client owns a single :class:`requests.Session`; reuse the client
    across calls to benefit from connection pooling. Use the client as a
    context manager to ensure the underlying session is closed::

        with Client(Config(base_url=..., realm=...)) as client:
            user = client.users.get("abc-123")
    """

    def __init__(
        self,
        config: Config,
        *,
        session: Optional[requests.Session] = None,
    ) -> None:
        self._config = config
        self._session = session if session is not None else requests.Session()
        self._users: Optional[UserService] = None
        self._discovery: Optional[DiscoveryService] = None
        self._roles: Optional[RoleService] = None
        self._groups: Optional[GroupService] = None
        self._closed = False

    @property
    def config(self) -> Config:
        """Return the immutable configuration this client was built with."""
        return self._config

    @property
    def session(self) -> requests.Session:
        """Return the underlying :class:`requests.Session`."""
        return self._session

    @property
    def users(self) -> UserService:
        """Return the lazily-instantiated :class:`UserService`."""
        if self._users is None:
            from idenplane.users import UserService

            self._users = UserService(self)
        return self._users

    @property
    def discovery(self) -> DiscoveryService:
        """Return the lazily-instantiated :class:`DiscoveryService`."""
        if self._discovery is None:
            from idenplane.discovery import DiscoveryService

            self._discovery = DiscoveryService(self)
        return self._discovery

    @property
    def roles(self) -> RoleService:
        """Return the lazily-instantiated :class:`RoleService`."""
        if self._roles is None:
            from idenplane.roles import RoleService

            self._roles = RoleService(self)
        return self._roles

    @property
    def groups(self) -> GroupService:
        """Return the lazily-instantiated :class:`GroupService`."""
        if self._groups is None:
            from idenplane.groups import GroupService

            self._groups = GroupService(self)
        return self._groups

    def auth_header(self) -> str:
        """Return the ``Authorization`` header value.

        Returns ``"Bearer <token>"`` when an admin token is configured, or an
        empty string when none is set. Callers should attach the header only
        when the returned string is truthy.
        """
        token = self._config.admin_token
        if not token:
            return ""
        return f"Bearer {token}"

    def default_headers(self) -> dict[str, str]:
        """Return the default headers attached to every request."""
        headers: dict[str, str] = {
            "Accept": "application/json",
            "User-Agent": self._config.user_agent,
        }
        if self._config.extra_headers:
            headers.update(self._config.extra_headers)
        return headers

    def _do_request(
        self,
        method: str,
        url: str,
        *,
        json: Optional[Any] = None,
        params: Optional[dict[str, str]] = None,
    ) -> requests.Response:
        """Build, authenticate, and dispatch an admin API request.

        Shared by every service (``users``, ``roles``, ``groups``, ...) so
        the header/auth/timeout/error-mapping logic lives in exactly one
        place. Always attaches ``Accept`` and ``User-Agent``. Adds
        ``Content-Type: application/json`` when a body is supplied. Attaches
        ``Authorization`` when the client has an admin token configured.
        Non-2xx responses raise the appropriate :class:`IdenplaneError`
        subclass.
        """
        headers = self.default_headers()
        if json is not None:
            headers["Content-Type"] = "application/json"
        auth = self.auth_header()
        if auth:
            headers["Authorization"] = auth

        try:
            resp = self._session.request(
                method=method,
                url=url,
                json=json,
                params=params,
                headers=headers,
                timeout=self._config.timeout_seconds,
            )
        except requests.RequestException as exc:
            raise IdenplaneError(f"HTTP request failed: {exc}") from exc

        _raise_for_status(resp)
        return resp

    def close(self) -> None:
        """Close the underlying HTTP session.

        Idempotent: safe to call more than once.
        """
        if not self._closed:
            self._session.close()
            self._closed = True

    def __enter__(self) -> Client:
        return self

    def __exit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()
