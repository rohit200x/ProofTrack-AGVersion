"""Argon2 password hashing and password policy."""

import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_hasher = PasswordHasher()  # argon2id with library defaults (RFC 9106 low-memory profile)
# Verified against when the account does not exist so timing does not reveal valid emails.
_DUMMY_HASH = _hasher.hash("prooftrack-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def validate_password_strength(password: str) -> list[str]:
    """Returns a list of human readable problems (empty if acceptable)."""
    problems: list[str] = []
    min_len = get_settings().password_min_length
    if len(password) < min_len:
        problems.append(f"Password must be at least {min_len} characters long.")
    if len(password) > 128:
        problems.append("Password must be at most 128 characters long.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        problems.append("Password must contain both letters and numbers.")
    return problems
