"""Tests for :mod:`idenplane.discovery`."""

from __future__ import annotations

import threading
import time
from typing import Any
from unittest import mock

import pytest
import responses

from idenplane import Client, Config, DiscoveryCache, IdenplaneError
from idenplane.exceptions import AuthError, NotFoundError


def _sample_discovery() -> dict[str, Any]:
    return {
        "issuer": "https://auth.example.com/realms/test",
        "authorization_endpoint": "https://auth.example.com/realms/test/protocol/openid-connect/auth",
        "token_endpoint": "https://auth.example.com/realms/test/protocol/openid-connect/token",
        "userinfo_endpoint": "https://auth.example.com/realms/test/protocol/openid-connect/userinfo",
        "jwks_uri": "https://auth.example.com/realms/test/protocol/openid-connect/certs",
        "scopes_supported": ["openid", "profile", "email"],
    }


def _make_client(base: str = "https://auth.example.com") -> Client:
    return Client(Config(base_url=base, realm="test"))


class TestDiscoveryCache:
    def test_empty_cache_returns_none(self) -> None:
        cache = DiscoveryCache()
        assert cache.get_cached("any") is None

    def test_set_then_get(self) -> None:
        cache = DiscoveryCache(ttl_seconds=60)
        cfg: dict[str, Any] = {"issuer": "https://i"}
        cache.set("r1", cfg)  # type: ignore[arg-type]
        result = cache.get_cached("r1")
        assert result is not None
        assert result["issuer"] == "https://i"

    def test_ttl_expiry(self) -> None:
        cache = DiscoveryCache(ttl_seconds=60)
        cache.set("r1", {"issuer": "https://i"})  # type: ignore[arg-type]

        # Fast-forward past the TTL window.
        with mock.patch("idenplane.discovery.time.monotonic", return_value=time.monotonic() + 120):
            assert cache.get_cached("r1") is None

    def test_invalidate_single_realm(self) -> None:
        cache = DiscoveryCache(ttl_seconds=60)
        cache.set("r1", {"issuer": "a"})  # type: ignore[arg-type]
        cache.set("r2", {"issuer": "b"})  # type: ignore[arg-type]
        cache.invalidate("r1")
        assert cache.get_cached("r1") is None
        assert cache.get_cached("r2") is not None

    def test_invalidate_all(self) -> None:
        cache = DiscoveryCache(ttl_seconds=60)
        cache.set("r1", {"issuer": "a"})  # type: ignore[arg-type]
        cache.set("r2", {"issuer": "b"})  # type: ignore[arg-type]
        cache.invalidate()
        assert len(cache) == 0

    def test_ttl_must_be_positive(self) -> None:
        with pytest.raises(ValueError, match="ttl_seconds"):
            DiscoveryCache(ttl_seconds=0)

    def test_concurrent_access_is_safe(self) -> None:
        cache = DiscoveryCache(ttl_seconds=60)
        errors: list[BaseException] = []

        def worker(n: int) -> None:
            try:
                for _ in range(100):
                    cache.set(f"realm-{n}", {"issuer": f"https://{n}"})  # type: ignore[arg-type]
                    cache.get_cached(f"realm-{n}")
            except BaseException as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors


class TestDiscoveryService:
    @responses.activate
    def test_get_fetches_and_caches(self) -> None:
        url = "https://auth.example.com/realms/test/.well-known/openid-configuration"
        responses.add(responses.GET, url, json=_sample_discovery(), status=200)

        with _make_client() as client:
            cfg = client.discovery.get()
            assert cfg["issuer"] == "https://auth.example.com/realms/test"

            # Second call should hit cache; only 1 HTTP call observed.
            cfg2 = client.discovery.get()
            assert cfg2 == cfg

        assert len(responses.calls) == 1

    @responses.activate
    def test_get_with_explicit_realm(self) -> None:
        url = "https://auth.example.com/realms/other/.well-known/openid-configuration"
        responses.add(responses.GET, url, json=_sample_discovery(), status=200)

        with _make_client() as client:
            cfg = client.discovery.get("other")
            assert cfg["issuer"]
        assert len(responses.calls) == 1

    @responses.activate
    def test_refresh_forces_network_call(self) -> None:
        url = "https://auth.example.com/realms/test/.well-known/openid-configuration"
        responses.add(responses.GET, url, json=_sample_discovery(), status=200)
        responses.add(responses.GET, url, json=_sample_discovery(), status=200)

        with _make_client() as client:
            client.discovery.get()
            client.discovery.refresh()

        assert len(responses.calls) == 2

    @responses.activate
    def test_invalidate_then_get_refetches(self) -> None:
        url = "https://auth.example.com/realms/test/.well-known/openid-configuration"
        responses.add(responses.GET, url, json=_sample_discovery(), status=200)
        responses.add(responses.GET, url, json=_sample_discovery(), status=200)

        with _make_client() as client:
            client.discovery.get()
            client.discovery.invalidate("test")
            client.discovery.get()
        assert len(responses.calls) == 2

    @responses.activate
    def test_404_raises_not_found(self) -> None:
        url = "https://auth.example.com/realms/test/.well-known/openid-configuration"
        responses.add(responses.GET, url, status=404, body="not found")

        with _make_client() as client, pytest.raises(NotFoundError) as exc_info:
            client.discovery.get()
        assert exc_info.value.status_code == 404

    @responses.activate
    def test_401_raises_auth_error(self) -> None:
        url = "https://auth.example.com/realms/test/.well-known/openid-configuration"
        responses.add(responses.GET, url, status=401, body="unauthorized")

        with _make_client() as client, pytest.raises(AuthError):
            client.discovery.get()

    @responses.activate
    def test_invalid_json_raises_idenplane_error(self) -> None:
        url = "https://auth.example.com/realms/test/.well-known/openid-configuration"
        responses.add(responses.GET, url, body="not json", status=200, content_type="application/json")

        with _make_client() as client, pytest.raises(IdenplaneError, match="not valid JSON"):
            client.discovery.get()

    @responses.activate
    def test_non_object_json_raises_idenplane_error(self) -> None:
        url = "https://auth.example.com/realms/test/.well-known/openid-configuration"
        responses.add(responses.GET, url, json=["not", "an", "object"], status=200)

        with _make_client() as client, pytest.raises(IdenplaneError, match="not a JSON object"):
            client.discovery.get()
