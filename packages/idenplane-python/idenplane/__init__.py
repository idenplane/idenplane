"""Idenplane Python SDK.

Server-side Python SDK for the Idenplane admin API: OIDC discovery, user
management, role management, and group management. Mirrors the Go SDK
(``idenplane-go``) feature-for-feature.

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
from idenplane.groups import CreateGroupRequest, Group, GroupService, UpdateGroupRequest
from idenplane.roles import CreateRoleRequest, Role, RoleService, UpdateRoleRequest
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
    "CreateGroupRequest",
    "CreateRoleRequest",
    "CreateUserRequest",
    "DiscoveryCache",
    "DiscoveryService",
    "Group",
    "GroupService",
    "IdenplaneError",
    "ListUsersOptions",
    "ListUsersResult",
    "NotFoundError",
    "OpenIDConfiguration",
    "RateLimitError",
    "Role",
    "RoleService",
    "ServerError",
    "UpdateGroupRequest",
    "UpdateRoleRequest",
    "UpdateUserRequest",
    "User",
    "UserService",
    "__version__",
]
