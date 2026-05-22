"""Tests for :mod:`idenplane.client`."""

from __future__ import annotations

import os
from unittest import mock

import pytest

from idenplane import Client, Config


class TestConfig:
    def test_defaults(self) -> None:
        cfg = Config(base_url="https://auth.example.com", realm="r1")
        assert cfg.base_url == "https://auth.example.com"
        assert cfg.realm == "r1"
        assert cfg.admin_token is None
        assert cfg.timeout_seconds == 30.0
        assert cfg.user_agent == "idenplane-python/0.3.0"

    def test_is_frozen(self) -> None:
        cfg = Config(base_url="https://a", realm="r")
        with pytest.raises((AttributeError, Exception)):
            cfg.realm = "r2"  # type: ignore[misc]

    def test_requires_base_url(self) -> None:
        with pytest.raises(ValueError, match="base_url"):
            Config(base_url="", realm="r")

    def test_requires_realm(self) -> None:
        with pytest.raises(ValueError, match="realm"):
            Config(base_url="https://a", realm="")

    def test_requires_positive_timeout(self) -> None:
        with pytest.raises(ValueError, match="timeout"):
            Config(base_url="https://a", realm="r", timeout_seconds=0)

    def test_base_url_normalized_strips_trailing_slash(self) -> None:
        cfg = Config(base_url="https://auth.example.com/", realm="r")
        assert cfg.base_url_normalized() == "https://auth.example.com"

    def test_base_url_normalized_strips_multiple_slashes(self) -> None:
        cfg = Config(base_url="https://auth.example.com///", realm="r")
        assert cfg.base_url_normalized() == "https://auth.example.com"

    def test_from_env_reads_all_three(self) -> None:
        env = {
            "IDENPLANE_BASE_URL": "https://env.example.com",
            "IDENPLANE_REALM": "env-realm",
            "IDENPLANE_ADMIN_TOKEN": "env-tok",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            cfg = Config.from_env()
        assert cfg.base_url == "https://env.example.com"
        assert cfg.realm == "env-realm"
        assert cfg.admin_token == "env-tok"

    def test_from_env_admin_token_optional(self) -> None:
        env = {
            "IDENPLANE_BASE_URL": "https://env.example.com",
            "IDENPLANE_REALM": "env-realm",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            cfg = Config.from_env()
        assert cfg.admin_token is None

    def test_from_env_missing_base_url_raises(self) -> None:
        env = {"IDENPLANE_REALM": "r"}
        with mock.patch.dict(os.environ, env, clear=True), pytest.raises(
            ValueError, match="IDENPLANE_BASE_URL"
        ):
            Config.from_env()

    def test_from_env_missing_realm_raises(self) -> None:
        env = {"IDENPLANE_BASE_URL": "https://a"}
        with mock.patch.dict(os.environ, env, clear=True), pytest.raises(
            ValueError, match="IDENPLANE_REALM"
        ):
            Config.from_env()


class TestClient:
    def test_auth_header_returns_bearer_when_token_set(self) -> None:
        client = Client(Config(base_url="https://a", realm="r", admin_token="abc"))
        try:
            assert client.auth_header() == "Bearer abc"
        finally:
            client.close()

    def test_auth_header_empty_when_no_token(self) -> None:
        client = Client(Config(base_url="https://a", realm="r"))
        try:
            assert client.auth_header() == ""
        finally:
            client.close()

    def test_users_property_is_lazy_and_cached(self) -> None:
        client = Client(Config(base_url="https://a", realm="r"))
        try:
            first = client.users
            second = client.users
            assert first is second
        finally:
            client.close()

    def test_discovery_property_is_lazy_and_cached(self) -> None:
        client = Client(Config(base_url="https://a", realm="r"))
        try:
            first = client.discovery
            second = client.discovery
            assert first is second
        finally:
            client.close()

    def test_close_is_idempotent(self) -> None:
        client = Client(Config(base_url="https://a", realm="r"))
        client.close()
        client.close()  # must not raise

    def test_context_manager_closes_session(self) -> None:
        with Client(Config(base_url="https://a", realm="r")) as client:
            assert client.session is not None
        assert client._closed is True

    def test_default_headers_includes_user_agent_and_accept(self) -> None:
        with Client(Config(base_url="https://a", realm="r")) as client:
            headers = client.default_headers()
            assert headers["Accept"] == "application/json"
            assert headers["User-Agent"] == "idenplane-python/0.3.0"

    def test_default_headers_merges_extra_headers(self) -> None:
        cfg = Config(
            base_url="https://a",
            realm="r",
            extra_headers={"X-Trace": "abc"},
        )
        with Client(cfg) as client:
            headers = client.default_headers()
            assert headers["X-Trace"] == "abc"
            assert headers["Accept"] == "application/json"
