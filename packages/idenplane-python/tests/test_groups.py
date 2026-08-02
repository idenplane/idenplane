"""Tests for :mod:`idenplane.groups`."""

from __future__ import annotations

import pytest
import responses
from responses import matchers

from idenplane import Client, Config, IdenplaneError
from idenplane.exceptions import AuthError, NotFoundError, RateLimitError, ServerError

BASE = "https://auth.example.com"
REALM = "test-realm"
GROUPS_URL = f"{BASE}/admin/realms/{REALM}/groups"


def _client(*, token: str | None = "admin-tok") -> Client:
    return Client(Config(base_url=BASE, realm=REALM, admin_token=token))


class TestCreate:
    @responses.activate
    def test_returns_created_group_directly(self) -> None:
        """Unlike users, groups return the full record synchronously on 201."""
        responses.add(
            responses.POST,
            GROUPS_URL,
            json={
                "id": "g-1",
                "realmId": "realm-1",
                "name": "engineering",
                "description": "Engineering team",
                "parentId": None,
                "createdAt": "2026-05-22T08:30:00.000Z",
                "updatedAt": "2026-05-22T08:30:00.000Z",
            },
            status=201,
        )

        with _client() as client:
            group = client.groups.create({"name": "engineering", "description": "Engineering team"})

        assert group["id"] == "g-1"
        assert group["name"] == "engineering"
        assert len(responses.calls) == 1  # no follow-up GET, unlike UserService.create

    @responses.activate
    def test_supports_parent_id_for_nested_groups(self) -> None:
        responses.add(
            responses.POST,
            GROUPS_URL,
            json={"id": "g-2", "name": "backend", "parentId": "g-1"},
            status=201,
            match=[matchers.json_params_matcher({"name": "backend", "parentId": "g-1"})],
        )

        with _client() as client:
            group = client.groups.create({"name": "backend", "parentId": "g-1"})

        assert group["parentId"] == "g-1"

    @responses.activate
    def test_path_is_sent_but_not_echoed_back(self) -> None:
        """Documents the known backend quirk: CreateGroupDto accepts `path`,
        but GroupsService.create never persists dto.path (no `path` column
        on the Prisma Group model), so the server never echoes it back.
        """
        responses.add(
            responses.POST,
            GROUPS_URL,
            json={"id": "g-1", "name": "engineering"},  # server drops `path` silently
            status=201,
            match=[matchers.json_params_matcher({"name": "engineering", "path": "/eng"})],
        )

        with _client() as client:
            group = client.groups.create({"name": "engineering", "path": "/eng"})

        assert "path" not in group

    @responses.activate
    def test_sets_authorization_header(self) -> None:
        responses.add(
            responses.POST,
            GROUPS_URL,
            json={"id": "g-1", "name": "engineering"},
            status=201,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.groups.create({"name": "engineering"})
        assert len(responses.calls) == 1

    @responses.activate
    def test_omits_authorization_when_no_token(self) -> None:
        responses.add(
            responses.POST,
            GROUPS_URL,
            json={"id": "g-1", "name": "engineering"},
            status=201,
        )

        with _client(token=None) as client:
            client.groups.create({"name": "engineering"})

        sent_headers = responses.calls[0].request.headers
        assert "Authorization" not in sent_headers

    def test_missing_name_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="name"):
            client.groups.create({})  # type: ignore[typeddict-item]

    @responses.activate
    def test_empty_body_raises(self) -> None:
        responses.add(responses.POST, GROUPS_URL, status=201, body="")
        with _client() as client, pytest.raises(IdenplaneError, match="empty or invalid JSON"):
            client.groups.create({"name": "engineering"})

    @responses.activate
    def test_500_raises_server_error(self) -> None:
        responses.add(responses.POST, GROUPS_URL, status=500, body="boom")
        with _client() as client, pytest.raises(ServerError):
            client.groups.create({"name": "engineering"})


class TestGet:
    @responses.activate
    def test_happy_path(self) -> None:
        responses.add(
            responses.GET,
            f"{GROUPS_URL}/g-1",
            json={
                "id": "g-1",
                "realmId": "realm-1",
                "name": "engineering",
                "description": "Engineering team",
                "parentId": None,
                "createdAt": "2026-05-22T08:30:00.000Z",
                "updatedAt": "2026-05-22T08:30:00.000Z",
            },
            status=200,
        )

        with _client() as client:
            group = client.groups.get("g-1")

        assert group["id"] == "g-1"
        assert group["name"] == "engineering"
        assert group["createdAt"] == "2026-05-22T08:30:00.000Z"

    @responses.activate
    def test_404_raises_not_found(self) -> None:
        responses.add(responses.GET, f"{GROUPS_URL}/missing", status=404, body="nope")
        with _client() as client, pytest.raises(NotFoundError) as exc_info:
            client.groups.get("missing")
        assert exc_info.value.status_code == 404

    @responses.activate
    def test_401_raises_auth_error(self) -> None:
        responses.add(responses.GET, f"{GROUPS_URL}/g-1", status=401)
        with _client() as client, pytest.raises(AuthError):
            client.groups.get("g-1")

    @responses.activate
    def test_url_encodes_group_id(self) -> None:
        responses.add(
            responses.GET,
            f"{GROUPS_URL}/foo%2Fbar",
            json={"id": "foo/bar", "name": "x"},
            status=200,
        )
        with _client() as client:
            group = client.groups.get("foo/bar")
        assert group["id"] == "foo/bar"

    def test_empty_group_id_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="group_id"):
            client.groups.get("")

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.GET,
            f"{GROUPS_URL}/g-1",
            json={"id": "g-1", "name": "engineering"},
            status=200,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.groups.get("g-1")
        assert len(responses.calls) == 1


class TestList:
    @responses.activate
    def test_returns_plain_list(self) -> None:
        """Groups don't paginate: list() returns a plain list, not a wrapper."""
        responses.add(
            responses.GET,
            GROUPS_URL,
            json=[
                {"id": "g-1", "name": "engineering"},
                {"id": "g-2", "name": "backend", "parentId": "g-1"},
            ],
            status=200,
        )

        with _client() as client:
            groups = client.groups.list()

        assert isinstance(groups, list)
        assert len(groups) == 2
        assert groups[0]["id"] == "g-1"
        assert groups[1]["parentId"] == "g-1"

    @responses.activate
    def test_empty_list(self) -> None:
        responses.add(responses.GET, GROUPS_URL, json=[], status=200)
        with _client() as client:
            groups = client.groups.list()
        assert groups == []

    @responses.activate
    def test_non_array_response_raises(self) -> None:
        responses.add(responses.GET, GROUPS_URL, json={"oops": True}, status=200)
        with _client() as client, pytest.raises(IdenplaneError, match="JSON array"):
            client.groups.list()

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.GET,
            GROUPS_URL,
            json=[],
            status=200,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.groups.list()
        assert len(responses.calls) == 1


class TestUpdate:
    @responses.activate
    def test_returns_updated_group_directly(self) -> None:
        """Unlike users, groups return the updated record synchronously on PUT."""
        responses.add(
            responses.PUT,
            f"{GROUPS_URL}/g-1",
            json={"id": "g-1", "name": "engineering", "description": "Updated"},
            status=200,
        )

        with _client() as client:
            group = client.groups.update("g-1", {"description": "Updated"})

        assert group["description"] == "Updated"
        assert len(responses.calls) == 1  # no follow-up GET, unlike UserService.update

    @responses.activate
    def test_supports_reparenting(self) -> None:
        responses.add(
            responses.PUT,
            f"{GROUPS_URL}/g-2",
            json={"id": "g-2", "name": "backend", "parentId": "g-3"},
            status=200,
            match=[matchers.json_params_matcher({"parentId": "g-3"})],
        )

        with _client() as client:
            group = client.groups.update("g-2", {"parentId": "g-3"})

        assert group["parentId"] == "g-3"

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.PUT,
            f"{GROUPS_URL}/g-1",
            json={"id": "g-1", "name": "engineering"},
            status=200,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.groups.update("g-1", {"description": "x"})

    @responses.activate
    def test_404_raises_not_found(self) -> None:
        responses.add(responses.PUT, f"{GROUPS_URL}/missing", status=404)
        with _client() as client, pytest.raises(NotFoundError):
            client.groups.update("missing", {"description": "x"})

    def test_empty_group_id_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="group_id"):
            client.groups.update("", {"description": "x"})


class TestDelete:
    @responses.activate
    def test_happy_path(self) -> None:
        responses.add(responses.DELETE, f"{GROUPS_URL}/g-1", status=204)
        with _client() as client:
            client.groups.delete("g-1")
        assert len(responses.calls) == 1

    @responses.activate
    def test_404_raises(self) -> None:
        responses.add(responses.DELETE, f"{GROUPS_URL}/missing", status=404)
        with _client() as client, pytest.raises(NotFoundError):
            client.groups.delete("missing")

    @responses.activate
    def test_429_raises_rate_limit(self) -> None:
        responses.add(responses.DELETE, f"{GROUPS_URL}/g-1", status=429, body="slow down")
        with _client() as client, pytest.raises(RateLimitError):
            client.groups.delete("g-1")

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.DELETE,
            f"{GROUPS_URL}/g-1",
            status=204,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.groups.delete("g-1")

    def test_empty_group_id_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="group_id"):
            client.groups.delete("")
