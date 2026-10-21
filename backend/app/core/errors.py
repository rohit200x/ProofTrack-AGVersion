"""Domain exceptions and the consistent API error envelope."""

from typing import Any


class AppError(Exception):
    """Base class for errors that are safe to show to API clients."""

    status_code = 400
    code = "BAD_REQUEST"

    def __init__(self, message: str, *, code: str | None = None, details: list[dict[str, Any]] | None = None,
                 headers: dict[str, str] | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.details = details or []
        self.headers = headers


class ValidationFailed(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"


class Unauthorized(AppError):
    status_code = 401
    code = "UNAUTHORIZED"


class Forbidden(AppError):
    status_code = 403
    code = "FORBIDDEN"


class NotFound(AppError):
    status_code = 404
    code = "NOT_FOUND"


class Conflict(AppError):
    status_code = 409
    code = "CONFLICT"


class InvalidTransition(Conflict):
    code = "INVALID_STATE_TRANSITION"


class PayloadTooLarge(AppError):
    status_code = 413
    code = "PAYLOAD_TOO_LARGE"


class UnsupportedMedia(AppError):
    status_code = 415
    code = "UNSUPPORTED_MEDIA"


class TooManyRequests(AppError):
    status_code = 429
    code = "RATE_LIMITED"


class ServiceUnavailable(AppError):
    status_code = 503
    code = "SERVICE_UNAVAILABLE"


def field_error(field: str, message: str) -> dict[str, str]:
    return {"field": field, "message": message}
