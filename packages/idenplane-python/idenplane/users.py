"""User admin service.

Wraps the realm-management user endpoints with typed inputs and a single
:meth:`UserService._do_request` helper that sets ``Authorization``,
``Content-Type``, and ``Accept`` headers consistently. Mirrors the Go
SDK's ``UserService``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import quote

import requests
from typing_extensions import NotRequired, TypedDict

from idenplane.exceptions import IdenplaneError, _raise_for_status

if TYPE_CHECKING:
    from idenplane.client import Client


class User(TypedDict, total=False):
    """User record returned by the admin API.

    The Idenplane admin API uses camelCase keys (``firstName``, ``lastName``,
    ``emailVerified``, ``createdTimestamp``); they are exposed here exactly
    as returned to avoid surprising callers who consult the REST docs.
    """

    id: str
    username: str
    email: str
    firstName: str
    lastName: str
    enabled: bool
    emailVerified: bool
    createdTimestamp: int
    updatedTimestamp: int
    attributes: dict[str, list[str]]
    groups: list[str]


class CreateUserRequest(TypedDict, total=False):
    """Payload for creating a user via the admin API."""

    username: str
    email: NotRequired[str]
    firstName: NotRequired[str]
    lastName: NotRequired[str]
    enabled: NotRequired[bool]
    emailVerified: NotRequired[bool]
    attributes: NotRequired[dict[str, list[str]]]


class UpdateUserRequest(TypedDict, total=False):
    """Partial-update payload. All fields are optional."""

    email: NotRequired[str]
    firstName: NotRequired[str]
    lastName: NotRequired[str]
    enabled: NotRequired[bool]
    emailVerified: NotRequired[bool]
    attributes: NotRequired[dict[str, list[str]]]


@dataclass
class ListUsersOptions:
    """Filters and pagination for :meth:`UserService.list`."""

    skip: int = 0
    limit: int = 50
    username: Optional[str] = None
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    search: Optional[str] = None
    enabled: Optional[bool] = None

    def to_query(self) -> dict[str, str]:
        """Render options as a flat query-parameter mapping."""
        params: dict[str, str] = {}
        if self.skip:
            params["first"] = str(self.skip)
        if self.limit:
            params["max"] = str(self.limit)
        if self.username:
            params["username"] = self.username
        if self.email:
            params["email"] = self.email
        if self.first_name:
            params["firstName"] = self.first_name
        if self.last_name:
            params["lastName"] = self.last_name
        if self.search:
            params["search"] = self.search
        if self.enabled is not None:
            params["enabled"] = "true" if self.enabled else "false"
        return params


class ListUsersResult(TypedDict):
    """Result wrapper returned by :meth:`UserService.list`."""

    total: int
    users: list[User]


class UserService:
    """Admin operations on the realm's users endpoint.

    Every method goes through :meth:`_do_request`, which sets the
    ``Authorization`` header on every call when an admin token is
    configured. This avoids the "missing auth header" bug class that the
    Go SDK previously suffered from.
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    # ------------------------------------------------------------------ URLs

    def _users_url(self) -> str:
        return (
            f"{self._client.config.base_url_normalized()}"
            f"/admin/realms/{self._client.config.realm}/users"
        )

    def _user_url(self, user_id: str) -> str:
        return f"{self._users_url()}/{quote(user_id, safe='')}"

    # -------------------------------------------------------------- helpers

    def _do_request(
        self,
        method: str,
        url: str,
        *,
        json: Optional[Any] = None,
        params: Optional[dict[str, str]] = None,
    ) -> requests.Response:
        """Build, authenticate, and dispatch an admin API request.

        Always attaches ``Accept`` and ``User-Agent``. Adds
        ``Content-Type: application/json`` when a body is supplied. Attaches
        ``Authorization`` when the client has an admin token configured.
        Non-2xx responses raise the appropriate :class:`IdenplaneError`
        subclass.
        """
        headers = self._client.default_headers()
        if json is not None:
            headers["Content-Type"] = "application/json"
        auth = self._client.auth_header()
        if auth:
            headers["Authorization"] = auth

        try:
            resp = self._client.session.request(
                method=method,
                url=url,
                json=json,
                params=params,
                headers=headers,
                timeout=self._client.config.timeout_seconds,
            )
        except requests.RequestException as exc:
            raise IdenplaneError(f"HTTP request failed: {exc}") from exc

        _raise_for_status(resp)
        return resp

    @staticmethod
    def _extract_id_from_location(location: str) -> str:
        """Parse the trailing path segment from a ``Location`` header."""
        cleaned = location.rstrip("/")
        if not cleaned:
            return ""
        idx = cleaned.rfind("/")
        if idx < 0:
            return cleaned
        return cleaned[idx + 1 :]

    @staticmethod
    def _parse_user_body(resp: requests.Response) -> Optional[User]:
        """Decode a JSON user body or return ``None`` if absent/invalid."""
        if not resp.content:
            return None
        try:
            data = resp.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        return data  # type: ignore[return-value]

    # --------------------------------------------------------------- public

    def create(self, req: CreateUserRequest) -> User:
        """Create a user and return the resulting record.

        The Idenplane admin API returns 201 with a ``Location`` header
        containing the new user's ID. We follow up with a ``GET`` to
        populate the full record. When the POST body itself already carries
        a full user representation (with an ``id``), it is returned as-is.

        Raises:
            IdenplaneError: When neither the body nor the ``Location`` header
                yields a user ID. (We never silently return partial data.)
        """
        if not req.get("username"):
            raise ValueError("CreateUserRequest.username is required")

        resp = self._do_request("POST", self._users_url(), json=dict(req))

        body = self._parse_user_body(resp)
        location_id = self._extract_id_from_location(resp.headers.get("Location", ""))

        if body is not None and body.get("id"):
            return body

        user_id = location_id or (body.get("id") if body else None) or ""
        if not user_id:
            raise IdenplaneError(
                "create user: server did not return a Location header or id",
                status_code=resp.status_code,
                body=resp.text,
            )

        return self.get(user_id)

    def get(self, user_id: str) -> User:
        """Fetch a single user by ID."""
        if not user_id:
            raise ValueError("user_id is required")
        resp = self._do_request("GET", self._user_url(user_id))
        body = self._parse_user_body(resp)
        if body is None:
            raise IdenplaneError(
                "get user: response body was empty or invalid JSON",
                status_code=resp.status_code,
                body=resp.text,
            )
        return body

    def list(self, opts: Optional[ListUsersOptions] = None) -> ListUsersResult:
        """List users with optional filters/pagination.

        The Idenplane admin API returns a JSON array. We wrap that into a
        :class:`ListUsersResult` so callers see ``total`` and ``users``
        rather than juggling indexing.
        """
        params = opts.to_query() if opts is not None else None
        resp = self._do_request("GET", self._users_url(), params=params)

        try:
            data = resp.json()
        except ValueError as exc:
            raise IdenplaneError(
                f"list users: response was not valid JSON: {exc}",
                status_code=resp.status_code,
                body=resp.text,
            ) from exc

        if not isinstance(data, list):
            raise IdenplaneError(
                "list users: response was not a JSON array",
                status_code=resp.status_code,
                body=resp.text,
            )

        users: list[User] = []
        for item in data:
            if isinstance(item, dict):
                users.append(item)  # type: ignore[arg-type]
        return {"total": len(users), "users": users}

    def update(self, user_id: str, req: UpdateUserRequest) -> User:
        """Apply a partial update to ``user_id``.

        The admin API returns 204 No Content for updates; we follow up with
        a ``GET`` so the caller has the post-update record. Raises
        :class:`NotFoundError` for unknown IDs.
        """
        if not user_id:
            raise ValueError("user_id is required")
        self._do_request("PUT", self._user_url(user_id), json=dict(req))
        return self.get(user_id)

    def delete(self, user_id: str) -> None:
        """Delete the user with the given ID. Raises on unknown IDs."""
        if not user_id:
            raise ValueError("user_id is required")
        self._do_request("DELETE", self._user_url(user_id))

    def reset_password(
        self,
        user_id: str,
        password: str,
        *,
        temporary: bool = False,
    ) -> None:
        """Set a new password for the user.

        When ``temporary`` is true the user is required to change the
        password on next login.
        """
        if not user_id:
            raise ValueError("user_id is required")
        if not password:
            raise ValueError("password is required")
        url = f"{self._user_url(user_id)}/reset-password"
        body = {
            "type": "password",
            "value": password,
            "temporary": temporary,
        }
        self._do_request("PUT", url, json=body)
