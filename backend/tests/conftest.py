"""Pytest fixtures and test database setup for ProofTrack backend tests."""

from __future__ import annotations

import io
import os
from pathlib import Path

# Configure test environment BEFORE importing app modules
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://prooftrack:prooftrack@127.0.0.1:5433/prooftrack_test",
)
os.environ["STORAGE_BACKEND"] = "memory"
os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-0123456789abcdef"
os.environ["SEED_ON_STARTUP"] = "false"
os.environ["S3_CREATE_BUCKET"] = "false"
os.environ["LOG_JSON"] = "false"

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import SessionLocal, engine
from app.main import app
from app.models import User
from app.models.enums import Role
from app.security.passwords import hash_password
from app.storage.base import get_storage
from app.storage.memory import MemoryStorage

DEFAULT_PASS = "ValidPass2026!"


def _ensure_test_database() -> None:
    """Create prooftrack_test database if it does not already exist, then run Alembic migrations."""
    admin_url = "postgresql://prooftrack:prooftrack@127.0.0.1:5433/postgres"
    with psycopg.connect(admin_url, autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = 'prooftrack_test'"
        ).fetchone()
        if not exists:
            conn.execute("CREATE DATABASE prooftrack_test")

    backend_dir = Path(__file__).resolve().parents[1]
    alembic_cfg = Config(str(backend_dir / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    command.upgrade(alembic_cfg, "head")


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    _ensure_test_database()
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def clean_state():
    """Truncate all application tables and reset in-memory storage before each test."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE TABLE "
                "delivery_events, delivery_proofs, deliveries, "
                "upload_requests, login_attempts, audit_logs, sessions, users "
                "RESTART IDENTITY CASCADE"
            )
        )
        conn.execute(text("DELETE FROM application_settings"))
        conn.execute(
            text(
                "INSERT INTO application_settings (key, value) VALUES "
                "('business_timezone', '\"America/Chicago\"'::jsonb), "
                "('proof_retention_days', '365'::jsonb)"
            )
        )
    storage = get_storage()
    if isinstance(storage, MemoryStorage):
        storage.reset()
    yield


@pytest.fixture()
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture()
def memory_storage() -> MemoryStorage:
    storage = get_storage()
    assert isinstance(storage, MemoryStorage)
    return storage


@pytest.fixture()
def users(db) -> dict[str, User]:
    pw_hash = hash_password(DEFAULT_PASS)
    admin = User(
        first_name="Elena",
        last_name="Vance",
        email="admin@prooftrack.test",
        role=Role.ADMIN.value,
        phone="+15125550101",
        password_hash=pw_hash,
        is_active=True,
        must_change_password=False,
    )
    manager = User(
        first_name="Marcus",
        last_name="Sterling",
        email="manager@prooftrack.test",
        role=Role.MANAGER.value,
        phone="+15125550102",
        password_hash=pw_hash,
        is_active=True,
        must_change_password=False,
    )
    driver1 = User(
        first_name="Devon",
        last_name="Brooks",
        email="driver1@prooftrack.test",
        role=Role.DRIVER.value,
        phone="+15125550103",
        password_hash=pw_hash,
        is_active=True,
        must_change_password=False,
    )
    driver2 = User(
        first_name="Carlos",
        last_name="Rivera",
        email="driver2@prooftrack.test",
        role=Role.DRIVER.value,
        phone="+15125550104",
        password_hash=pw_hash,
        is_active=True,
        must_change_password=False,
    )
    inactive_driver = User(
        first_name="Sam",
        last_name="Inactive",
        email="inactive@prooftrack.test",
        role=Role.DRIVER.value,
        phone="+15125550105",
        password_hash=pw_hash,
        is_active=False,
        must_change_password=False,
    )
    db.add_all([admin, manager, driver1, driver2, inactive_driver])
    db.commit()
    for u in (admin, manager, driver1, driver2, inactive_driver):
        db.refresh(u)
    return {
        "admin": admin,
        "manager": manager,
        "driver1": driver1,
        "driver2": driver2,
        "inactive_driver": inactive_driver,
    }


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def login_as(client: TestClient, email: str, password: str = DEFAULT_PASS) -> dict:
    """Authenticate the TestClient and automatically attach the returned CSRF token header."""
    client.headers.pop("X-CSRF-Token", None)
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    client.headers["X-CSRF-Token"] = data["csrf_token"]
    return data


def make_image_bytes(
    fmt: str = "JPEG",
    size: tuple[int, int] = (640, 480),
    color: tuple[int, int, int] = (30, 90, 160),
) -> bytes:
    """Generate a valid in-memory image in the requested format."""
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()
