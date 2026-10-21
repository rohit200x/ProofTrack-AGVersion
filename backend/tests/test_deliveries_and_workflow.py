"""Tests for delivery CRUD, assignment, driver isolation, state transitions, concurrency, and DB triggers."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models.delivery import Delivery, DeliveryEvent
from tests.conftest import login_as, make_image_bytes


def _sample_delivery_payload(**overrides) -> dict:
    base = {
        "recipient_name": "Sarah Connor",
        "recipient_phone": "512-555-0144",
        "address_line1": "742 Evergreen Terrace",
        "address_line2": "Apt 2B",
        "city": "Austin",
        "state": "TX",
        "zip_code": "78701",
        "scheduled_date": date.today().isoformat(),
        "time_window_start": "09:00",
        "time_window_end": "13:00",
        "instructions": "Ring doorbell twice",
        "manager_notes": "Priority commercial parcel",
    }
    base.update(overrides)
    return base


def test_delivery_creation_and_validation(client, users):
    login_as(client, "manager@prooftrack.test")

    # Auto-generated reference
    r1 = client.post("/api/v1/deliveries", json=_sample_delivery_payload())
    assert r1.status_code == 201, r1.text
    d1 = r1.json()
    assert d1["reference"].startswith("PT-")
    assert d1["status"] == "PENDING"
    assert d1["recipient_phone"] == "+15125550144"

    # Custom reference + duplicate check
    r2 = client.post("/api/v1/deliveries", json=_sample_delivery_payload(reference="PT-CUST-0001"))
    assert r2.status_code == 201
    dup = client.post("/api/v1/deliveries", json=_sample_delivery_payload(reference="PT-CUST-0001"))
    assert dup.status_code == 409

    # Invalid state and time window
    bad_state = client.post("/api/v1/deliveries", json=_sample_delivery_payload(state="XX"))
    assert bad_state.status_code == 422
    bad_window = client.post(
        "/api/v1/deliveries",
        json=_sample_delivery_payload(time_window_start="15:00", time_window_end="11:00"),
    )
    assert bad_window.status_code == 422


def test_assignment_unassignment_and_driver_isolation(client, users):
    login_as(client, "manager@prooftrack.test")
    d1 = client.post("/api/v1/deliveries", json=_sample_delivery_payload()).json()
    d2 = client.post(
        "/api/v1/deliveries",
        json=_sample_delivery_payload(
            recipient_name="Other Recipient",
            assigned_driver_id=str(users["driver2"].id),
        ),
    ).json()
    assert d2["status"] == "ASSIGNED"

    # Assign inactive driver -> rejected
    bad_assign = client.post(
        f"/api/v1/deliveries/{d1['id']}/assign",
        json={"driver_id": str(users["inactive_driver"].id)},
    )
    assert bad_assign.status_code == 422

    # Assign driver1 to d1
    assigned = client.post(
        f"/api/v1/deliveries/{d1['id']}/assign",
        json={"driver_id": str(users["driver1"].id)},
    )
    assert assigned.status_code == 200
    assert assigned.json()["status"] == "ASSIGNED"
    assert assigned.json()["assigned_driver"]["id"] == str(users["driver1"].id)

    # Driver 1 logs in and sees ONLY d1, never d2
    login_as(client, "driver1@prooftrack.test")
    my_list = client.get("/api/v1/driver/deliveries").json()
    assert [item["id"] for item in my_list] == [d1["id"]]

    # Driver 1 cannot view or mutate Driver 2's delivery
    assert client.get(f"/api/v1/deliveries/{d2['id']}").status_code == 403
    assert client.get(f"/api/v1/deliveries/{d2['id']}/events").status_code == 403
    assert client.get(f"/api/v1/deliveries/{d2['id']}/proofs").status_code == 403
    assert client.post(f"/api/v1/deliveries/{d2['id']}/start").status_code == 403
    assert (
        client.post(
            f"/api/v1/deliveries/{d2['id']}/fail",
            data={"reason": "RECIPIENT_UNAVAILABLE"},
        ).status_code
        == 403
    )

    # Manager can unassign d1 while still ASSIGNED
    login_as(client, "manager@prooftrack.test")
    unassigned = client.post(f"/api/v1/deliveries/{d1['id']}/unassign")
    assert unassigned.status_code == 200
    assert unassigned.json()["status"] == "PENDING"
    assert unassigned.json()["assigned_driver"] is None


def test_status_transitions_and_optimistic_concurrency(client, users):
    login_as(client, "manager@prooftrack.test")
    d = client.post(
        "/api/v1/deliveries",
        json=_sample_delivery_payload(assigned_driver_id=str(users["driver1"].id)),
    ).json()
    did = d["id"]
    v1 = d["version"]

    # Update with current version -> increments version
    upd = client.patch(f"/api/v1/deliveries/{did}", json={"instructions": "Updated note", "version": v1})
    assert upd.status_code == 200
    assert upd.json()["version"] == v1 + 1

    # Update with stale version -> 409 VERSION_CONFLICT
    stale = client.patch(f"/api/v1/deliveries/{did}", json={"instructions": "Stale edit", "version": v1})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"

    # Driver starts delivery -> IN_TRANSIT
    login_as(client, "driver1@prooftrack.test")
    started = client.post(f"/api/v1/deliveries/{did}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "IN_TRANSIT"

    # Manager cannot reassign while IN_TRANSIT
    login_as(client, "manager@prooftrack.test")
    reassign_in_transit = client.post(
        f"/api/v1/deliveries/{did}/assign",
        json={"driver_id": str(users["driver2"].id)},
    )
    assert reassign_in_transit.status_code == 409

    # Driver reports failed attempt (OTHER requires notes)
    login_as(client, "driver1@prooftrack.test")
    missing_notes = client.post(
        f"/api/v1/deliveries/{did}/fail",
        data={"reason": "OTHER", "idempotency_key": "fail-key-0001"},
    )
    assert missing_notes.status_code == 422

    failed = client.post(
        f"/api/v1/deliveries/{did}/fail",
        data={
            "reason": "OTHER",
            "notes": "Security gate locked and guard unreachable",
            "idempotency_key": "fail-key-0002",
        },
        files={"image": ("gate.jpg", make_image_bytes(), "image/jpeg")},
    )
    assert failed.status_code == 200
    assert failed.json()["status"] == "FAILED"
    assert failed.json()["failure_reason"] == "OTHER"

    # Manager reopens failed delivery and assigns back to driver1
    login_as(client, "manager@prooftrack.test")
    reopened = client.post(
        f"/api/v1/deliveries/{did}/reopen",
        json={
            "reason": "Customer provided updated gate code for afternoon retry",
            "driver_id": str(users["driver1"].id),
        },
    )
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "ASSIGNED"

    # Audit events persisted in order
    events = client.get(f"/api/v1/deliveries/{did}/events").json()
    event_types = [e["event_type"] for e in events]
    assert event_types == ["CREATED", "ASSIGNED", "UPDATED", "STARTED", "FAILED", "REOPENED"]


def test_database_integrity_triggers(client, db, users):
    """Verify PostgreSQL triggers prevent event mutation and DELIVERED status without a proof row."""
    login_as(client, "manager@prooftrack.test")
    d = client.post(
        "/api/v1/deliveries",
        json=_sample_delivery_payload(assigned_driver_id=str(users["driver1"].id)),
    ).json()
    did = d["id"]

    # 1. delivery_events is append-only
    evt = db.scalar(select(DeliveryEvent).where(DeliveryEvent.delivery_id == did))
    assert evt is not None
    with pytest.raises(DBAPIError):
        db.execute(
            text("DELETE FROM delivery_events WHERE id = :id"),
            {"id": evt.id},
        )
        db.commit()
    db.rollback()

    # 2. Setting status='DELIVERED' directly in SQL without a DELIVERY proof row fails at COMMIT
    with pytest.raises(DBAPIError):
        db.execute(
            text("UPDATE deliveries SET status = 'DELIVERED', delivered_at = now() WHERE id = :id"),
            {"id": did},
        )
        db.commit()
    db.rollback()

    # Delivery remains ASSIGNED
    fresh = db.scalar(select(Delivery).where(Delivery.id == did))
    assert fresh.status == "ASSIGNED"
