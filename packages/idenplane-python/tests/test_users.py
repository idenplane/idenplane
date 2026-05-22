"""Tests for :mod:`idenplane.users`."""

from __future__ import annotations

import pytest
import responses
from responses import matchers

from idenplane import Client, Config, IdenplaneError, ListUsersOptions
from idenplane.exceptions import AuthError, NotFoundError, RateLimitError, ServerError

BASE = "https://auth.example.com"
REALM = "test-realm"
USERS_URL = f"{BASE}/admin/realms/{REALM}/users"


def _client(*, token: str | None = "admin-tok") -> Client:
    return Client(Config(base_url=BASE, realm=REALM, admin_token=token))


class TestCreate:
    @responses.activate
    def test_returns_body_when_full_record_in_post(self) -> None:
        responses.add(
            responses.POST,
            USERS_URL,
            json={"id": "u-1", "username": "alice", "enabled": True},
            status=201,
        )

        with _client() as client:
            user = client.users.create({"username": "alice", "enabled": True})

        assert user["id"] == "u-1"
        assert user["username"] == "alice"

    @responses.activate
    def test_follows_location_header(self) -> None:
        location = f"{USERS_URL}/u-loc"
        responses.add(
            responses.POST,
            USERS_URL,
            status=201,
            headers={"Location": location},
        )
        responses.add(
            responses.GET,
            f"{USERS_URL}/u-loc",
            json={"id": "u-loc", "username": "bob", "enabled": True},
            status=200,
        )

        with _client() as client:
            user = client.users.create({"username": "bob", "enabled": True})

        assert user["id"] == "u-loc"
        assert user["username"] == "bob"
        assert len(responses.calls) == 2

    @responses.activate
    def test_sets_authorization_header(self) -> None:
        responses.add(
            responses.POST,
            USERS_URL,
            json={"id": "u-1", "username": "alice"},
            status=201,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )

        with _client() as client:
            client.users.create({"username": "alice"})
        assert len(responses.calls) == 1

    @responses.activate
    def test_omits_authorization_when_no_token(self) -> None:
        responses.add(
            responses.POST,
            USERS_URL,
            json={"id": "u-1", "username": "alice"},
            status=201,
        )

        with _client(token=None) as client:
            client.users.create({"username": "alice"})

        sent_headers = responses.calls[0].request.headers
        assert "Authorization" not in sent_headers

    def test_missing_username_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="username"):
            client.users.create({})  # type: ignore[typeddict-item]

    @responses.activate
    def test_no_id_anywhere_raises_loudly(self) -> None:
        """Defends against the "silent partial-data" bug fixed in Go SDK."""
        responses.add(responses.POST, USERS_URL, status=201, body="")

        with _client() as client, pytest.raises(IdenplaneError, match="Location header or id"):
            client.users.create({"username": "alice"})

    @responses.activate
    def test_500_raises_server_error(self) -> None:
        responses.add(responses.POST, USERS_URL, status=500, body="boom")
        with _client() as client, pytest.raises(ServerError):
            client.users.create({"username": "alice"})


class TestGet:
    @responses.activate
    def test_happy_path(self) -> None:
        responses.add(
            responses.GET,
            f"{USERS_URL}/u-1",
            json={
                "id": "u-1",
                "username": "alice",
                "email": "a@example.com",
                "firstName": "Alice",
                "enabled": True,
                "emailVerified": True,
                "createdAt": "2026-05-22T08:30:00.000Z",
                "updatedAt": "2026-05-22T08:30:00.000Z",
            },
            status=200,
        )

        with _client() as client:
            user = client.users.get("u-1")

        assert user["id"] == "u-1"
        assert user["firstName"] == "Alice"
        assert user["emailVerified"] is True
        assert user["createdAt"] == "2026-05-22T08:30:00.000Z"
        assert user["updatedAt"] == "2026-05-22T08:30:00.000Z"

    @responses.activate
    def test_404_raises_not_found(self) -> None:
        responses.add(responses.GET, f"{USERS_URL}/missing", status=404, body="nope")
        with _client() as client, pytest.raises(NotFoundError) as exc_info:
            client.users.get("missing")
        assert exc_info.value.status_code == 404

    @responses.activate
    def test_401_raises_auth_error(self) -> None:
        responses.add(responses.GET, f"{USERS_URL}/u-1", status=401)
        with _client() as client, pytest.raises(AuthError):
            client.users.get("u-1")

    @responses.activate
    def test_403_also_raises_auth_error(self) -> None:
        responses.add(responses.GET, f"{USERS_URL}/u-1", status=403)
        with _client() as client, pytest.raises(AuthError):
            client.users.get("u-1")

    @responses.activate
    def test_url_encodes_user_id(self) -> None:
        responses.add(
            responses.GET,
            f"{USERS_URL}/foo%2Fbar",
            json={"id": "foo/bar", "username": "x"},
            status=200,
        )
        with _client() as client:
            user = client.users.get("foo/bar")
        assert user["id"] == "foo/bar"

    def test_empty_user_id_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="user_id"):
            client.users.get("")

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.GET,
            f"{USERS_URL}/u-1",
            json={"id": "u-1"},
            status=200,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.users.get("u-1")
        assert len(responses.calls) == 1


class TestList:
    @responses.activate
    def test_returns_total_and_users(self) -> None:
        responses.add(
            responses.GET,
            USERS_URL,
            json=[
                {"id": "u-1", "username": "a"},
                {"id": "u-2", "username": "b"},
            ],
            status=200,
        )

        with _client() as client:
            result = client.users.list()

        assert result["total"] == 2
        assert len(result["users"]) == 2
        assert result["users"][0]["id"] == "u-1"

    @responses.activate
    def test_empty_list(self) -> None:
        responses.add(responses.GET, USERS_URL, json=[], status=200)
        with _client() as client:
            result = client.users.list()
        assert result["total"] == 0
        assert result["users"] == []

    @responses.activate
    def test_sends_pagination_params(self) -> None:
        responses.add(
            responses.GET,
            USERS_URL,
            json=[],
            status=200,
            match=[matchers.query_param_matcher({"page": "3", "limit": "25"})],
        )
        with _client() as client:
            client.users.list(ListUsersOptions(page=3, limit=25))
        assert len(responses.calls) == 1

    @responses.activate
    def test_default_pagination_is_page_one_limit_twenty(self) -> None:
        """Defaults must match backend ListUsersQueryDto (page=1, limit=20)."""
        responses.add(
            responses.GET,
            USERS_URL,
            json=[],
            status=200,
            match=[matchers.query_param_matcher({"page": "1", "limit": "20"})],
        )
        with _client() as client:
            client.users.list(ListUsersOptions())
        assert len(responses.calls) == 1

    @responses.activate
    def test_sends_filter_params(self) -> None:
        responses.add(
            responses.GET,
            USERS_URL,
            json=[],
            status=200,
            match=[
                matchers.query_param_matcher(
                    {
                        "page": "1",
                        "limit": "20",
                        "username": "alice",
                        "email": "a@e.com",
                        "firstName": "Alice",
                        "lastName": "Smith",
                        "search": "ali",
                        "enabled": "true",
                    }
                )
            ],
        )
        with _client() as client:
            client.users.list(
                ListUsersOptions(
                    username="alice",
                    email="a@e.com",
                    first_name="Alice",
                    last_name="Smith",
                    search="ali",
                    enabled=True,
                )
            )

    @responses.activate
    def test_enabled_false_serialized(self) -> None:
        responses.add(
            responses.GET,
            USERS_URL,
            json=[],
            status=200,
            match=[
                matchers.query_param_matcher(
                    {"page": "1", "limit": "20", "enabled": "false"}
                )
            ],
        )
        with _client() as client:
            client.users.list(ListUsersOptions(enabled=False))

    @responses.activate
    def test_iso_timestamps_round_trip(self) -> None:
        """User contract: createdAt/updatedAt are ISO 8601 strings.

        Locks the wire contract: Prisma serializes DateTime → ISO strings,
        not Unix-epoch integers.
        """
        responses.add(
            responses.GET,
            USERS_URL,
            json=[
                {
                    "id": "u-1",
                    "username": "alice",
                    "email": "a@example.com",
                    "firstName": "Alice",
                    "lastName": "A",
                    "enabled": True,
                    "emailVerified": True,
                    "createdAt": "2026-05-22T08:30:00.000Z",
                    "updatedAt": "2026-05-22T09:00:00.000Z",
                }
            ],
            status=200,
        )
        with _client() as client:
            result = client.users.list()

        assert result["total"] == 1
        user = result["users"][0]
        assert user["createdAt"] == "2026-05-22T08:30:00.000Z"
        assert user["updatedAt"] == "2026-05-22T09:00:00.000Z"
        # Old keys must be absent (would silently flow through if Backend changed).
        assert "createdTimestamp" not in user
        assert "updatedTimestamp" not in user

    @responses.activate
    def test_non_array_response_raises(self) -> None:
        responses.add(responses.GET, USERS_URL, json={"oops": True}, status=200)
        with _client() as client, pytest.raises(IdenplaneError, match="JSON array"):
            client.users.list()


class TestUpdate:
    @responses.activate
    def test_happy_path_returns_updated_user(self) -> None:
        responses.add(responses.PUT, f"{USERS_URL}/u-1", status=204)
        responses.add(
            responses.GET,
            f"{USERS_URL}/u-1",
            json={"id": "u-1", "email": "new@example.com", "enabled": True},
            status=200,
        )

        with _client() as client:
            user = client.users.update("u-1", {"email": "new@example.com"})

        assert user["email"] == "new@example.com"

    @responses.activate
    def test_update_sends_authorization_header(self) -> None:
        responses.add(
            responses.PUT,
            f"{USERS_URL}/u-1",
            status=204,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        responses.add(responses.GET, f"{USERS_URL}/u-1", json={"id": "u-1"}, status=200)

        with _client() as client:
            client.users.update("u-1", {"enabled": False})

    @responses.activate
    def test_404_raises_not_found(self) -> None:
        responses.add(responses.PUT, f"{USERS_URL}/missing", status=404)
        with _client() as client, pytest.raises(NotFoundError):
            client.users.update("missing", {"enabled": False})


class TestDelete:
    @responses.activate
    def test_happy_path(self) -> None:
        responses.add(responses.DELETE, f"{USERS_URL}/u-1", status=204)
        with _client() as client:
            client.users.delete("u-1")
        assert len(responses.calls) == 1

    @responses.activate
    def test_404_raises(self) -> None:
        responses.add(responses.DELETE, f"{USERS_URL}/missing", status=404)
        with _client() as client, pytest.raises(NotFoundError):
            client.users.delete("missing")

    @responses.activate
    def test_sends_authorization_header(self) -> None:
        responses.add(
            responses.DELETE,
            f"{USERS_URL}/u-1",
            status=204,
            match=[matchers.header_matcher({"Authorization": "Bearer admin-tok"})],
        )
        with _client() as client:
            client.users.delete("u-1")


class TestResetPassword:
    @responses.activate
    def test_happy_path(self) -> None:
        responses.add(
            responses.PUT,
            f"{USERS_URL}/u-1/reset-password",
            status=204,
            match=[
                matchers.json_params_matcher(
                    {"type": "password", "value": "S3cret!", "temporary": False}
                )
            ],
        )

        with _client() as client:
            client.users.reset_password("u-1", "S3cret!")
        assert len(responses.calls) == 1

    @responses.activate
    def test_temporary_flag(self) -> None:
        responses.add(
            responses.PUT,
            f"{USERS_URL}/u-1/reset-password",
            status=204,
            match=[
                matchers.json_params_matcher(
                    {"type": "password", "value": "x", "temporary": True}
                )
            ],
        )
        with _client() as client:
            client.users.reset_password("u-1", "x", temporary=True)

    def test_empty_password_raises(self) -> None:
        with _client() as client, pytest.raises(ValueError, match="password"):
            client.users.reset_password("u-1", "")

    @responses.activate
    def test_429_raises_rate_limit(self) -> None:
        responses.add(
            responses.PUT,
            f"{USERS_URL}/u-1/reset-password",
            status=429,
            body="slow down",
        )
        with _client() as client, pytest.raises(RateLimitError):
            client.users.reset_password("u-1", "S3cret!")
