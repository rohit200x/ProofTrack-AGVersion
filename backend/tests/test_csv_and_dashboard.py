"""Tests for CSV import/export, dashboard metrics, attention queues, settings, and health checks."""

from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import login_as, make_image_bytes


def test_csv_template_import_validation_and_export(client, users):
    login_as(client, "manager@prooftrack.test")

    # 1. Template download
    tpl = client.get("/api/v1/deliveries/import-template")
    assert tpl.status_code == 200
    assert "recipient_name,recipient_phone,address_line1" in tpl.text

    today = date.today().isoformat()

    # 2. CSV with validation error -> dry_run reports valid and invalid rows
    mixed_csv = (
        "reference,recipient_name,recipient_phone,address_line1,city,state,zip_code,scheduled_date,driver_email\n"
        f"PT-CSV-0001,Alice Smith,5125550111,100 Congress Ave,Austin,TX,78701,{today},driver1@prooftrack.test\n"
        f"PT-CSV-0002,Bob Invalid,5125550112,200 Main St,Austin,INVALID_STATE,999,{today},nobody@prooftrack.test\n"
    ).encode("utf-8")

    dry = client.post(
        "/api/v1/deliveries/import?dry_run=true",
        files={"file": ("mixed.csv", mixed_csv, "text/csv")},
    )
    assert dry.status_code == 200
    dry_data = dry.json()
    assert dry_data["dry_run"] is True
    assert dry_data["valid_rows"] == 1
    assert dry_data["invalid_rows"] == 1
    assert dry_data["created"] == 0

    # 3. Transactional import without allow_partial -> creates 0 rows when any row is invalid
    atomic_fail = client.post(
        "/api/v1/deliveries/import",
        files={"file": ("mixed.csv", mixed_csv, "text/csv")},
    )
    assert atomic_fail.status_code == 200
    assert atomic_fail.json()["created"] == 0
    assert client.get("/api/v1/deliveries").json()["total"] == 0

    # 4. Valid CSV import -> creates deliveries and assigns driver where specified
    valid_csv = (
        "reference,recipient_name,recipient_phone,address_line1,city,state,zip_code,scheduled_date,driver_email\n"
        f"PT-CSV-0001,Alice Smith,5125550111,100 Congress Ave,Austin,TX,78701,{today},driver1@prooftrack.test\n"
        f"PT-CSV-0002,Charlie Brown,5125550113,300 Lamar Blvd,Austin,TX,78704,{today},\n"
    ).encode("utf-8")

    imported = client.post(
        "/api/v1/deliveries/import",
        files={"file": ("valid.csv", valid_csv, "text/csv")},
    )
    assert imported.status_code == 200
    imp_data = imported.json()
    assert imp_data["created"] == 2
    assert imp_data["invalid_rows"] == 0

    # 5. CSV Export
    exported = client.get("/api/v1/deliveries/export")
    assert exported.status_code == 200
    assert "PT-CSV-0001" in exported.text
    assert "PT-CSV-0002" in exported.text


def test_dashboard_metrics_search_filters_and_health(client, users):
    login_as(client, "manager@prooftrack.test")
    today = date.today()
    yesterday = today - timedelta(days=2)

    # Create 1 overdue PENDING delivery, 1 ASSIGNED delivery, and 1 CANCELED delivery
    d_overdue = client.post(
        "/api/v1/deliveries",
        json={
            "recipient_name": "Overdue Customer",
            "address_line1": "10 Old Rd",
            "city": "Dallas",
            "state": "TX",
            "zip_code": "75201",
            "scheduled_date": yesterday.isoformat(),
        },
    ).json()

    d_active = client.post(
        "/api/v1/deliveries",
        json={
            "recipient_name": "Completed Customer",
            "address_line1": "20 Fast Ln",
            "city": "Houston",
            "state": "TX",
            "zip_code": "77002",
            "scheduled_date": today.isoformat(),
            "assigned_driver_id": str(users["driver1"].id),
        },
    ).json()

    d_cancel = client.post(
        "/api/v1/deliveries",
        json={
            "recipient_name": "Canceled Customer",
            "address_line1": "30 Stop Ave",
            "city": "Austin",
            "state": "TX",
            "zip_code": "78701",
            "scheduled_date": today.isoformat(),
        },
    ).json()
    client.post(f"/api/v1/deliveries/{d_cancel['id']}/cancel", json={"reason": "Order canceled by sender"})

    # Driver completes d_active
    login_as(client, "driver1@prooftrack.test")
    client.post(
        f"/api/v1/deliveries/{d_active['id']}/complete",
        data={"idempotency_key": "dash-complete-001"},
        files=[("images", ("pod.jpg", make_image_bytes(), "image/jpeg"))],
    )

    # Verify dashboard summary KPIs
    login_as(client, "manager@prooftrack.test")
    summary = client.get("/api/v1/dashboard/summary").json()
    assert summary["total"] == 3
    assert summary["pending"] == 1
    assert summary["delivered"] == 1
    assert summary["canceled"] == 1
    assert summary["overdue"] == 1
    # completion_pct = delivered / (total - canceled) = 1 / 2 = 50.0%
    assert summary["completion_pct"] == 50.0

    attention = client.get("/api/v1/dashboard/attention").json()
    assert [x["id"] for x in attention["overdue"]] == [d_overdue["id"]]
    assert [x["id"] for x in attention["recently_completed"]] == [d_active["id"]]

    activity = client.get("/api/v1/dashboard/activity").json()
    assert activity["total"] >= 5

    # Verify search and filters
    houston = client.get("/api/v1/deliveries?search=Houston&has_proof=true").json()
    assert houston["total"] == 1
    assert houston["items"][0]["id"] == d_active["id"]

    overdue_list = client.get("/api/v1/deliveries?overdue=true").json()
    assert overdue_list["total"] == 1
    assert overdue_list["items"][0]["id"] == d_overdue["id"]

    # Health & readiness
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/ready").status_code == 200
