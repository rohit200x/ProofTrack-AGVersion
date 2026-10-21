"""Opaque session tokens (stored hashed) and CSRF tokens bound to the session."""

import hashlib
import hmac
import secrets

from app.core.config import get_settings


def generate_session_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """SHA-256 of a high-entropy random token is sufficient (no need for slow hashing)."""
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token_for(session_token_hash: str) -> str:
    """CSRF token = HMAC(secret_key, session token hash). Cannot be forged without the server secret
    and is invalidated automatically when the session changes."""
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"csrf:{session_token_hash}".encode(), hashlib.sha256).hexdigest()


def verify_csrf(session_token_hash: str, presented: str | None) -> bool:
    if not presented:
        return False
    return hmac.compare_digest(csrf_token_for(session_token_hash), presented)
