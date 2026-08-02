"""Role admin service.

Wraps the realm-management realm-roles endpoints with typed inputs. Unlike
users and groups, roles are addressed by **name**, not by ID (see
``RolesController``/``RolesService`` in the NestJS backend). Mirrors the Go
SDK's ``RoleService``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import quote

import requests
from typing_extensions import NotRequired, TypedDict

from idenplane.exceptions import IdenplaneError

if TYPE_CHECKING:
    from idenplane.client import Client


class Role(TypedDict, total=False):
    """Realm role record returned by the admin API.

    ``clientId`` is only populated for client roles. The endpoints wrapped
    by this SDK (``/admin/realms/{realm}/roles``) only address realm roles,
    so ``clientId`` is typically absent, but the field is kept on the read
    model in case the server ever returns a client role through the same
    shape.

    ``createdAt`` and ``updatedAt`` are ISO 8601 timestamp strings because
    Prisma serializes ``DateTime`` columns to ISO strings on the wire.
    """

    id: str
    realmId: str
    clientId: str
    name: str
    description: str
    createdAt: str
    updatedAt: str


class CreateRoleRequest(TypedDict, total=False):
    """Payload for creating a realm role via the admin API."""

    name: str
    description: NotRequired[str]


class UpdateRoleRequest(TypedDict, total=False):
    """Partial-update payload. All fields are optional."""

    name: NotRequired[str]
    description: NotRequired[str]


class RoleService:
    """Admin operations on the realm's roles endpoint.

    Roles are addressed by name rather than by ID. Every method goes
    through :meth:`_do_request`, which delegates to
    :meth:`idenplane.client.Client._do_request` so the header/auth/
    error-mapping logic lives in one place shared with ``UserService`` and
    ``GroupService``.
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    # ------------------------------------------------------------------ URLs

    def _roles_url(self) -> str:
        return (
            f"{self._client.config.base_url_normalized()}"
            f"/admin/realms/{self._client.config.realm}/roles"
        )

    def _role_url(self, name: str) -> str:
        return f"{self._roles_url()}/{quote(name, safe='')}"

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

        See :meth:`idenplane.client.Client._do_request` for the full
        contract (headers, auth, error mapping).
        """
        return self._client._do_request(method, url, json=json, params=params)

    @staticmethod
    def _parse_role_body(resp: requests.Response) -> Optional[Role]:
        """Decode a JSON role body or return ``None`` if absent/invalid."""
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

    def create(self, req: CreateRoleRequest) -> Role:
        """Create a realm role and return the resulting record.

        Unlike ``UserService.create``, the admin API returns the full role
        record directly in the response body on 201, so no follow-up
        ``GET`` is needed.
        """
        if not req.get("name"):
            raise ValueError("CreateRoleRequest.name is required")

        resp = self._do_request("POST", self._roles_url(), json=dict(req))
        body = self._parse_role_body(resp)
        if body is None:
            raise IdenplaneError(
                "create role: response body was empty or invalid JSON",
                status_code=resp.status_code,
                body=resp.text,
            )
        return body

    def get(self, name: str) -> Role:
        """Fetch a single realm role by name.

        Raises:
            NotFoundError: If no role with ``name`` exists in the realm.
        """
        if not name:
            raise ValueError("name is required")
        resp = self._do_request("GET", self._role_url(name))
        body = self._parse_role_body(resp)
        if body is None:
            raise IdenplaneError(
                "get role: response body was empty or invalid JSON",
                status_code=resp.status_code,
                body=resp.text,
            )
        return body

    def list(self) -> list[Role]:
        """List all realm roles.

        The admin API returns a plain JSON array with no pagination
        parameters, so this returns a plain ``list`` rather than a result
        wrapper (unlike ``UserService.list``).
        """
        resp = self._do_request("GET", self._roles_url())

        try:
            data = resp.json()
        except ValueError as exc:
            raise IdenplaneError(
                f"list roles: response was not valid JSON: {exc}",
                status_code=resp.status_code,
                body=resp.text,
            ) from exc

        if not isinstance(data, list):
            raise IdenplaneError(
                "list roles: response was not a JSON array",
                status_code=resp.status_code,
                body=resp.text,
            )

        roles: list[Role] = []
        for item in data:
            if isinstance(item, dict):
                roles.append(item)  # type: ignore[arg-type]
        return roles

    def update(self, name: str, req: UpdateRoleRequest) -> Role:
        """Apply a partial update to the role named ``name``.

        Unlike ``UserService.update``, the admin API returns the updated
        record directly in the response body on 200, so no follow-up
        ``GET`` is needed.

        Raises:
            NotFoundError: If no role with ``name`` exists in the realm.
        """
        if not name:
            raise ValueError("name is required")
        resp = self._do_request("PUT", self._role_url(name), json=dict(req))
        body = self._parse_role_body(resp)
        if body is None:
            raise IdenplaneError(
                "update role: response body was empty or invalid JSON",
                status_code=resp.status_code,
                body=resp.text,
            )
        return body

    def delete(self, name: str) -> None:
        """Delete the realm role named ``name``.

        Raises:
            NotFoundError: If no role with ``name`` exists in the realm.
        """
        if not name:
            raise ValueError("name is required")
        self._do_request("DELETE", self._role_url(name))
