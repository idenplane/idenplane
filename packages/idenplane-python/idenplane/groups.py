"""Group admin service.

Wraps the realm-management groups endpoints with typed inputs. Groups are
addressed by ID (unlike roles, which are addressed by name) and support
nesting via ``parentId``. Mirrors the Go SDK's ``GroupService``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import quote

import requests
from typing_extensions import NotRequired, TypedDict

from idenplane.exceptions import IdenplaneError

if TYPE_CHECKING:
    from idenplane.client import Client


class Group(TypedDict, total=False):
    """Group record returned by the admin API.

    ``parentId`` is absent/``None`` for top-level groups and set to the
    parent group's ID for nested groups.

    ``path`` is accepted on create/update requests but, as of the current
    server implementation, is never persisted: the Prisma ``Group`` model
    has no ``path`` column, and ``GroupsService.create``/``update`` never
    write ``dto.path`` into the database. It is kept on this TypedDict for
    forward compatibility in case the server starts returning it, but
    callers should not expect it to be populated.

    ``createdAt`` and ``updatedAt`` are ISO 8601 timestamp strings because
    Prisma serializes ``DateTime`` columns to ISO strings on the wire.

    The live API's list/get responses also include a ``_count`` object
    (member/role-mapping counts); it is intentionally not modeled here.
    """

    id: str
    realmId: str
    name: str
    description: str
    parentId: str
    path: str
    createdAt: str
    updatedAt: str


class CreateGroupRequest(TypedDict, total=False):
    """Payload for creating a group via the admin API.

    ``path`` is accepted by the backend's ``CreateGroupDto`` but is not
    persisted (see the caveat on :class:`Group`); it is included here only
    because the wire contract currently accepts it as input.
    """

    name: str
    description: NotRequired[str]
    parentId: NotRequired[str]
    path: NotRequired[str]


class UpdateGroupRequest(TypedDict, total=False):
    """Partial-update payload. All fields are optional.

    See the ``path`` caveat on :class:`CreateGroupRequest`.
    """

    name: NotRequired[str]
    description: NotRequired[str]
    parentId: NotRequired[str]
    path: NotRequired[str]


class GroupService:
    """Admin operations on the realm's groups endpoint.

    Groups are addressed by ID and support nesting via ``parentId``. Every
    method goes through :meth:`_do_request`, which delegates to
    :meth:`idenplane.client.Client._do_request` so the header/auth/
    error-mapping logic lives in one place shared with ``UserService`` and
    ``RoleService``.
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    # ------------------------------------------------------------------ URLs

    def _groups_url(self) -> str:
        return (
            f"{self._client.config.base_url_normalized()}"
            f"/admin/realms/{self._client.config.realm}/groups"
        )

    def _group_url(self, group_id: str) -> str:
        return f"{self._groups_url()}/{quote(group_id, safe='')}"

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
    def _parse_group_body(resp: requests.Response) -> Optional[Group]:
        """Decode a JSON group body or return ``None`` if absent/invalid."""
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

    def create(self, req: CreateGroupRequest) -> Group:
        """Create a group and return the resulting record.

        Unlike ``UserService.create``, the admin API returns the full group
        record directly in the response body on 201, so no follow-up
        ``GET`` is needed.
        """
        if not req.get("name"):
            raise ValueError("CreateGroupRequest.name is required")

        resp = self._do_request("POST", self._groups_url(), json=dict(req))
        body = self._parse_group_body(resp)
        if body is None:
            raise IdenplaneError(
                "create group: response body was empty or invalid JSON",
                status_code=resp.status_code,
                body=resp.text,
            )
        return body

    def get(self, group_id: str) -> Group:
        """Fetch a single group by ID.

        Raises:
            NotFoundError: If no group with ``group_id`` exists in the realm.
        """
        if not group_id:
            raise ValueError("group_id is required")
        resp = self._do_request("GET", self._group_url(group_id))
        body = self._parse_group_body(resp)
        if body is None:
            raise IdenplaneError(
                "get group: response body was empty or invalid JSON",
                status_code=resp.status_code,
                body=resp.text,
            )
        return body

    def list(self) -> list[Group]:
        """List all groups in the realm.

        The admin API returns a plain JSON array with no pagination
        parameters, so this returns a plain ``list`` rather than a result
        wrapper (unlike ``UserService.list``).
        """
        resp = self._do_request("GET", self._groups_url())

        try:
            data = resp.json()
        except ValueError as exc:
            raise IdenplaneError(
                f"list groups: response was not valid JSON: {exc}",
                status_code=resp.status_code,
                body=resp.text,
            ) from exc

        if not isinstance(data, list):
            raise IdenplaneError(
                "list groups: response was not a JSON array",
                status_code=resp.status_code,
                body=resp.text,
            )

        groups: list[Group] = []
        for item in data:
            if isinstance(item, dict):
                groups.append(item)  # type: ignore[arg-type]
        return groups

    def update(self, group_id: str, req: UpdateGroupRequest) -> Group:
        """Apply a partial update to the group with the given ID.

        Unlike ``UserService.update``, the admin API returns the updated
        record directly in the response body on 200, so no follow-up
        ``GET`` is needed.

        Raises:
            NotFoundError: If no group with ``group_id`` exists in the realm.
        """
        if not group_id:
            raise ValueError("group_id is required")
        resp = self._do_request("PUT", self._group_url(group_id), json=dict(req))
        body = self._parse_group_body(resp)
        if body is None:
            raise IdenplaneError(
                "update group: response body was empty or invalid JSON",
                status_code=resp.status_code,
                body=resp.text,
            )
        return body

    def delete(self, group_id: str) -> None:
        """Delete the group with the given ID.

        Raises:
            NotFoundError: If no group with ``group_id`` exists in the realm.
        """
        if not group_id:
            raise ValueError("group_id is required")
        self._do_request("DELETE", self._group_url(group_id))
