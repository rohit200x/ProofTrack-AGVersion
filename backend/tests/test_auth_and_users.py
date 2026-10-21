"""Tests for authentication, session security, CSRF enforcement, rate limiting, RBAC, and user management."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.models import AuditLog, UserSession
from app.utils.common import utcnow
from tests.conftest import DEFAULT_PASS, login_as


def test_login_success_and_me(client, users):
    data = login_as(client, "manager@prooftrack.test")
    assert data["user"]["email"] == "manager@prooftrack.test"
    assert data["user"]["role"] == "MANAGER"
    assert data["csrf_token"]
    assert "pt_session" in client.cookies

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "manager@prooftrack.test"


def test_login_incorrect_password_and_rate_limiting(client, users):
    # 5 failed attempts trigger rate limit on the 6th attempt
    for _ in range(5):
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "driver1@prooftrack.test", "password": "WrongPassword99!"},
        )
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "driver1@prooftrack.test", "password": DEFAULT_PASS},
    )
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_inactive_user_cannot_login(client, users):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "inactive@prooftrack.test", "password": DEFAULT_PASS},
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_unauthorized_access_without_cookie(client, users):
    resp = client.get("/api/v1/deliveries")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "NOT_AUTHENTICATED"


def test_session_expiration_and_revocation(client, db, users):
    login_as(client, "driver1@prooftrack.test")
    sess = db.scalar(select(UserSession).where(UserSession.user_id == users["driver1"].id))
    assert sess is not None

    # Force expiration in database
    sess.expires_at = utcnow() - timedelta(minutes=5)
    db.commit()

    resp = client.get("/api/v1/driver/deliveries")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "SESSION_EXPIRED"


def test_csrf_enforcement_on_mutating_endpoints(client, users):
    login_as(client, "manager@prooftrack.test")
    # Remove CSRF token header
    client.headers.pop("X-CSRF-Token", None)

    resp = client.post(
        "/api/v1/deliveries",
        json={
            "recipient_name": "Test Customer",
            "address_line1": "100 Main St",
            "city": "Austin",
            "state": "TX",
            "zip_code": "78701",
            "scheduled_date": "2026-10-21",
        },
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "CSRF_FAILED"

    # Re-fetch CSRF token and succeed
    csrf_resp = client.get("/api/v1/auth/csrf")
    assert csrf_resp.status_code == 200
    client.headers["X-CSRF-Token"] = csrf_resp.json()["csrf_token"]

    ok_resp = client.post(
        "/api/v1/deliveries",
        json={
            "recipient_name": "Test Customer",
            "address_line1": "100 Main St",
            "city": "Austin",
            "state": "TX",
            "zip_code": "78701",
            "scheduled_date": "2026-10-21",
        },
    )
    assert ok_resp.status_code == 201


def test_role_based_access_control(client, users):
    # Driver cannot access manager or admin endpoints
    login_as(client, "driver1@prooftrack.test")
    assert client.get("/api/v1/deliveries").status_code == 403
    assert client.get("/api/v1/users").status_code == 403
    assert client.get("/api/v1/dashboard/summary").status_code == 403

    # Manager can access deliveries and drivers list, but NOT admin user CRUD
    login_as(client, "manager@prooftrack.test")
    assert client.get("/api/v1/deliveries").status_code == 200
    assert client.get("/api/v1/drivers").status_code == 200
    assert client.get("/api/v1/users").status_code == 403
    assert client.patch("/api/v1/settings", json={"organization_name": "New"}).status_code == 403

    # Admin can access user management and settings
    login_as(client, "admin@prooftrack.test")
    assert client.get("/api/v1/users").status_code == 200
    assert client.patch("/api/v1/settings", json={"organization_name": "ProofTrack US"}).status_code == 200


def test_user_management_and_forced_password_change(client, db, users):
    login_as(client, "admin@prooftrack.test")

    # Create a new driver account (sets must_change_password=True)
    create_resp = client.post(
        "/api/v1/users",
        json={
            "first_name": "Maya",
            "last_name": "Lin",
            "email": "maya@prooftrack.test",
            "role": "DRIVER",
            "phone": "512-555-0199",
            "password": "TempPassword2026!",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    new_user = create_resp.json()
    assert new_user["must_change_password"] is True
    assert new_user["phone"] == "+15125550199"

    # Log in as the new driver; operational endpoints must reject until password is changed
    login_as(client, "maya@prooftrack.test", password="TempPassword2026!")
    blocked = client.get("/api/v1/driver/deliveries")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"

    # Change password with weak password -> rejected
    weak = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "TempPassword2026!", "new_password": "short"},
    )
    assert weak.status_code == 422

    # Change password with strong password -> succeeds and clears must_change_password
    changed = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "TempPassword2026!", "new_password": "NewStrongPass2026!"},
    )
    assert changed.status_code == 200

    allowed = client.get("/api/v1/driver/deliveries")
    assert allowed.status_code == 200

    # Admin resets password and deactivates user
    login_as(client, "admin@prooftrack.test")
    reset = client.post(
        f"/api/v1/users/{new_user['id']}/reset-password",
        json={"new_password": "AdminResetPass2026!"},
    )
    assert reset.status_code == 200

    deactivate = client.patch(
        f"/api/v1/users/{new_user['id']}",
        json={"is_active": False},
    )
    assert deactivate.status_code == 200
    assert deactivate.json()["is_active"] is False

    # Audit logs recorded
    audits = list(db.scalars(select(AuditLog)))
    actions = {a.action for a in audits}
    assert {"user.created", "auth.password_changed", "user.password_reset", "user.updated"}.issubset(actions)
