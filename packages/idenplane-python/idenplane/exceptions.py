"""Exception hierarchy for the Idenplane SDK.

All SDK errors derive from :class:`IdenplaneError`. HTTP errors carry the
originating ``status_code`` and response ``body`` so callers can introspect
failures without re-issuing the request.
"""

from __future__ import annotations

from typing import Optional

import requests


class IdenplaneError(Exception):
    """Base class for all Idenplane SDK errors.

    Attributes:
        message: Human-readable error message.
        status_code: HTTP status code if the error originated from a response.
        body: Raw response body if available.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        body: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.body = body

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}(message={self.message!r}, "
            f"status_code={self.status_code!r})"
        )


class AuthError(IdenplaneError):
    """Raised on 401 Unauthorized or 403 Forbidden responses."""


class NotFoundError(IdenplaneError):
    """Raised on 404 Not Found responses."""


class RateLimitError(IdenplaneError):
    """Raised on 429 Too Many Requests responses."""


class ServerError(IdenplaneError):
    """Raised on 5xx Server Error responses."""


def _read_body(resp: requests.Response) -> Optional[str]:
    """Safely read a response body without raising."""
    try:
        text = resp.text
    except Exception:
        return None
    return text if text else None


def _raise_for_status(resp: requests.Response) -> None:
    """Map ``requests.Response`` status codes to typed SDK exceptions.

    Successful responses (2xx) return silently. Any non-2xx status raises the
    most specific exception available.
    """
    status = resp.status_code
    if 200 <= status < 300:
        return

    body = _read_body(resp)
    message = f"HTTP {status} from {resp.request.method if resp.request else '?'} {resp.url}"

    if status in (401, 403):
        raise AuthError(message, status_code=status, body=body)
    if status == 404:
        raise NotFoundError(message, status_code=status, body=body)
    if status == 429:
        raise RateLimitError(message, status_code=status, body=body)
    if 500 <= status < 600:
        raise ServerError(message, status_code=status, body=body)
    raise IdenplaneError(message, status_code=status, body=body)
