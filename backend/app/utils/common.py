"""Utility helpers: UTC clock, request metadata, normalization."""

import ipaddress
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from fastapi import Request


def utcnow() -> datetime:
    return datetime.now(UTC)


def client_ip(request: Request) -> str | None:
    """Client IP as seen by the app. Behind a reverse proxy, run uvicorn with --proxy-headers
    and --forwarded-allow-ips so request.client reflects X-Forwarded-For from trusted proxies only."""
    host = request.client.host if request.client else None
    if not host:
        return None
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return None


def normalize_email(email: str) -> str:
    return email.strip().lower()


def tz(name: str) -> ZoneInfo:
    return ZoneInfo(name)
