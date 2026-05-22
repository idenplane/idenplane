"""Idenplane Python SDK.

Server-side Python SDK for the Idenplane admin API: OIDC discovery and
user management. Mirrors the Go SDK (``idenplane-go``) feature-for-feature.

Quick start::

    from idenplane import Client, Config

    with Client(Config(
        base_url="https://auth.example.com",
        realm="my-realm",
        admin_token="...",
    )) as client:
        oidc = client.discovery.get("my-realm")
        user = client.users.create({"username": "alice", "enabled": True})
"""

from idenplane.client import Client, Config
from idenplane.discovery import DiscoveryCache, DiscoveryService, OpenIDConfiguration
from idenplane.exceptions import (
    AuthError,
    IdenplaneError,
    NotFoundError,
    RateLimitError,
    ServerError,
)
from idenplane.users import (
    CreateUserRequest,
    ListUsersOptions,
    ListUsersResult,
    UpdateUserRequest,
    User,
    UserService,
)

__version__ = "0.3.0"

__all__ = [
    "AuthError",
    "Client",
    "Config",
    "CreateUserRequest",
    "DiscoveryCache",
    "DiscoveryService",
    "IdenplaneError",
    "ListUsersOptions",
    "ListUsersResult",
    "NotFoundError",
    "OpenIDConfiguration",
    "RateLimitError",
    "ServerError",
    "UpdateUserRequest",
    "User",
    "UserService",
    "__version__",
]
