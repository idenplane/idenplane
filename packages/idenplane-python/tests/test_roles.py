"""Tests for :mod:`idenplane.roles`."""

from __future__ import annotations

import pytest
import responses
from responses import matchers

from idenplane import Client, Config, IdenplaneError
from idenplane.exceptions import AuthError, NotFoundError, RateLimitError, ServerError

BASE = "https://auth.example.com"
REALM = "test-realm"
ROLES_URL = f"{BASE}/admin/realms/{REALM}/roles"


def _client(*, token: str | None = "admin-tok") -> Client:
    return Client(Config(base_url=BASE, realm=REALM, admin_token=token))


class TestCreate:
    @responses.activate
    def test_returns_created_role_directly(self) -> None:
        """Unlike users, roles return the full record synchronously on 201."""
        responses.add(
            responses.POST,
            ROLES_URL,
            json={
                "id": "r-1",
                "realmId": "realm-1",
                "name": "admin",
                "description": "Administrator role",
                "createdAt": "2026-05-22T08:30:00.000Z",
                "updatedAt": "2026-05-22T08:30:00.000Z",
            },
            status=201,
        )

        with _client() as client:
            role = client.roles.create({"name": "admin", "description": "Administrator role"})

        assert role["id"] == "r-1"
        assert role["name"] == "admin"
        assert role["description"] == "Administrator role"
        assert len(responses.calls) == 1  # no follow-up GET, unlike UserService.create

    @responses.activate
    def test_sets_authorization_header(self) -> None:
        responses.add(
            responses.POST,
            ROLES_URL,
            json={"id": "r-1", "name": "admin"},
            status=201,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )

        with _client() as client:
            client.roles.create({"name": "admin"})
        assert len(responses.calls) == 1

    @responses.activate
    def test_omits_authorization_when_no_token(self) -> None:
        responses.add(
            responses.POST,
            ROLES_URL,
            json={"id": "r-1", "name": "admin"},
            status=201,
        )

        with _client(token=None) as client:
            client.roles.create({"name": "admin"})

        sent_headers = responses.calls[0].request.headers
        assert "Authorization" not in sent_headers

    def test_missing_name_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="name"):
            client.roles.create({})  # type: ignore[typeddict-item]

    @responses.activate
    def test_empty_body_raises(self) -> None:
        responses.add(responses.POST, ROLES_URL, status=201, body="")
        with _client() as client, pytest.raises(IdenplaneError, match="empty or invalid JSON"):
            client.roles.create({"name": "admin"})

    @responses.activate
    def test_500_raises_server_error(self) -> None:
        responses.add(responses.POST, ROLES_URL, status=500, body="boom")
        with _client() as client, pytest.raises(ServerError):
            client.roles.create({"name": "admin"})


class TestGet:
    @responses.activate
    def test_happy_path(self) -> None:
        responses.add(
            responses.GET,
            f"{ROLES_URL}/admin",
            json={
                "id": "r-1",
                "realmId": "realm-1",
                "name": "admin",
                "description": "Administrator role",
                "createdAt": "2026-05-22T08:30:00.000Z",
                "updatedAt": "2026-05-22T08:30:00.000Z",
            },
            status=200,
        )

        with _client() as client:
            role = client.roles.get("admin")

        assert role["id"] == "r-1"
        assert role["name"] == "admin"
        assert role["createdAt"] == "2026-05-22T08:30:00.000Z"

    @responses.activate
    def test_404_raises_not_found(self) -> None:
        responses.add(responses.GET, f"{ROLES_URL}/missing", status=404, body="nope")
        with _client() as client, pytest.raises(NotFoundError) as exc_info:
            client.roles.get("missing")
        assert exc_info.value.status_code == 404

    @responses.activate
    def test_401_raises_auth_error(self) -> None:
        responses.add(responses.GET, f"{ROLES_URL}/admin", status=401)
        with _client() as client, pytest.raises(AuthError):
            client.roles.get("admin")

    @responses.activate
    def test_url_encodes_name(self) -> None:
        responses.add(
            responses.GET,
            f"{ROLES_URL}/foo%2Fbar",
            json={"id": "r-1", "name": "foo/bar"},
            status=200,
        )
        with _client() as client:
            role = client.roles.get("foo/bar")
        assert role["name"] == "foo/bar"

    def test_empty_name_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="name"):
            client.roles.get("")

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.GET,
            f"{ROLES_URL}/admin",
            json={"id": "r-1", "name": "admin"},
            status=200,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.roles.get("admin")
        assert len(responses.calls) == 1


class TestList:
    @responses.activate
    def test_returns_plain_list(self) -> None:
        """Roles don't paginate: list() returns a plain list, not a wrapper."""
        responses.add(
            responses.GET,
            ROLES_URL,
            json=[
                {"id": "r-1", "name": "admin"},
                {"id": "r-2", "name": "viewer"},
            ],
            status=200,
        )

        with _client() as client:
            roles = client.roles.list()

        assert isinstance(roles, list)
        assert len(roles) == 2
        assert roles[0]["id"] == "r-1"
        assert roles[1]["name"] == "viewer"

    @responses.activate
    def test_empty_list(self) -> None:
        responses.add(responses.GET, ROLES_URL, json=[], status=200)
        with _client() as client:
            roles = client.roles.list()
        assert roles == []

    @responses.activate
    def test_non_array_response_raises(self) -> None:
        responses.add(responses.GET, ROLES_URL, json={"oops": True}, status=200)
        with _client() as client, pytest.raises(IdenplaneError, match="JSON array"):
            client.roles.list()

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.GET,
            ROLES_URL,
            json=[],
            status=200,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.roles.list()
        assert len(responses.calls) == 1


class TestUpdate:
    @responses.activate
    def test_returns_updated_role_directly(self) -> None:
        """Unlike users, roles return the updated record synchronously on PUT."""
        responses.add(
            responses.PUT,
            f"{ROLES_URL}/admin",
            json={"id": "r-1", "name": "admin", "description": "Updated"},
            status=200,
        )

        with _client() as client:
            role = client.roles.update("admin", {"description": "Updated"})

        assert role["description"] == "Updated"
        assert len(responses.calls) == 1  # no follow-up GET, unlike UserService.update

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.PUT,
            f"{ROLES_URL}/admin",
            json={"id": "r-1", "name": "admin"},
            status=200,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.roles.update("admin", {"description": "x"})

    @responses.activate
    def test_404_raises_not_found(self) -> None:
        responses.add(responses.PUT, f"{ROLES_URL}/missing", status=404)
        with _client() as client, pytest.raises(NotFoundError):
            client.roles.update("missing", {"description": "x"})

    def test_empty_name_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="name"):
            client.roles.update("", {"description": "x"})


class TestDelete:
    @responses.activate
    def test_happy_path(self) -> None:
        responses.add(responses.DELETE, f"{ROLES_URL}/admin", status=204)
        with _client() as client:
            client.roles.delete("admin")
        assert len(responses.calls) == 1

    @responses.activate
    def test_404_raises(self) -> None:
        responses.add(responses.DELETE, f"{ROLES_URL}/missing", status=404)
        with _client() as client, pytest.raises(NotFoundError):
            client.roles.delete("missing")

    @responses.activate
    def test_429_raises_rate_limit(self) -> None:
        responses.add(responses.DELETE, f"{ROLES_URL}/admin", status=429, body="slow down")
        with _client() as client, pytest.raises(RateLimitError):
            client.roles.delete("admin")

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.DELETE,
            f"{ROLES_URL}/admin",
            status=204,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.roles.delete("admin")

    def test_empty_name_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="name"):
            client.roles.delete("")
