"""Tests for proof-of-delivery photo validation, atomic storage & DB persistence, idempotency,
failure rollback, proof access control, flagging/deletion, orphan reconciliation, and real MinIO S3."""

from __future__ import annotations

import io
import uuid
from datetime import date, timedelta

import pytest
from PIL import Image
from pillow_heif import register_heif_opener
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.models.delivery import DeliveryProof
from app.models.ops import UploadRequest
from app.services import delivery as delivery_service
from app.storage.s3 import S3Storage
from tests.conftest import login_as, make_image_bytes

register_heif_opener()


def _create_assigned_delivery(client, driver_id: str) -> dict:
    login_as(client, "manager@prooftrack.test")
    resp = client.post(
        "/api/v1/deliveries",
        json={
            "recipient_name": "Elena Gilbert",
            "recipient_phone": "512-555-0188",
            "address_line1": "500 Congress Ave",
            "city": "Austin",
            "state": "TX",
            "zip_code": "78701",
            "scheduled_date": date.today().isoformat(),
            "assigned_driver_id": driver_id,
        },
    )
    assert resp.status_code == 201
    return resp.json()


def test_complete_delivery_valid_formats_jpeg_png_webp_heic(client, db, memory_storage, users):
    d = _create_assigned_delivery(client, str(users["driver1"].id))
    did = d["id"]

    login_as(client, "driver1@prooftrack.test")
    client.post(f"/api/v1/deliveries/{did}/start")

    # Prepare JPEG, PNG, WebP, and HEIC images
    jpeg_bytes = make_image_bytes("JPEG", (800, 600), (40, 120, 200))
    png_bytes = make_image_bytes("PNG", (500, 400), (80, 160, 90))
    webp_bytes = make_image_bytes("WEBP", (600, 450), (180, 90, 60))
    heic_buf = io.BytesIO()
    Image.new("RGB", (400, 300), (120, 60, 180)).save(heic_buf, format="HEIF")
    heic_bytes = heic_buf.getvalue()

    resp = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={
            "idempotency_key": "complete-multi-format-001",
            "recipient_name": "E. Gilbert (Front Desk)",
            "driver_notes": "Left package at reception desk",
            "latitude": "30.267153",
            "longitude": "-97.743061",
            "location_accuracy_m": "8.5",
            "location_consent": "true",
        },
        files=[
            ("images", ("photo1.jpg", jpeg_bytes, "image/jpeg")),
            ("images", ("photo2.png", png_bytes, "image/png")),
            ("images", ("photo3.webp", webp_bytes, "image/webp")),
            ("images", ("photo4.heic", heic_bytes, "image/heic")),
        ],
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status"] == "DELIVERED"
    assert out["proof_count"] == 4
    assert out["recipient_name_confirmed"] == "E. Gilbert (Front Desk)"
    assert out["delivered_at"] is not None

    proofs = client.get(f"/api/v1/deliveries/{did}/proofs").json()
    assert len(proofs) == 4
    ctypes = {p["content_type"] for p in proofs}
    assert ctypes == {"image/jpeg", "image/png", "image/webp", "image/heic"}
    assert float(proofs[0]["latitude"]) == pytest.approx(30.267153)
    assert proofs[0]["location_consent"] is True

    # Each proof stores original + preview + thumbnail (3 objects * 4 proofs = 12 objects)
    assert len(memory_storage.objects) == 12


def test_complete_delivery_rejects_missing_corrupted_nonimage_and_oversized(client, users, monkeypatch):
    d = _create_assigned_delivery(client, str(users["driver1"].id))
    did = d["id"]
    login_as(client, "driver1@prooftrack.test")

    # 1. Missing photo -> 422 PROOF_REQUIRED
    no_img = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "err-no-img-001"},
    )
    assert no_img.status_code == 422
    assert no_img.json()["error"]["code"] == "PROOF_REQUIRED"

    # 2. Non-image disguised as .jpg -> 422 INVALID_IMAGE
    non_img = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "err-non-img-001"},
        files=[("images", ("fake.jpg", b"not an image at all, just plain text", "image/jpeg"))],
    )
    assert non_img.status_code == 422
    assert non_img.json()["error"]["code"] == "INVALID_IMAGE"

    # 3. Truncated / corrupted JPEG -> 422 INVALID_IMAGE
    valid_jpeg = make_image_bytes("JPEG", (800, 800))
    corrupted_jpeg = valid_jpeg[: len(valid_jpeg) // 2]
    corrupt_resp = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "err-corrupt-001"},
        files=[("images", ("broken.jpg", corrupted_jpeg, "image/jpeg"))],
    )
    assert corrupt_resp.status_code == 422
    assert corrupt_resp.json()["error"]["code"] == "INVALID_IMAGE"

    # 4. Unsupported image format (GIF) -> 415 UNSUPPORTED_IMAGE_TYPE
    gif_buf = io.BytesIO()
    Image.new("RGB", (100, 100), (255, 0, 0)).save(gif_buf, format="GIF")
    gif_resp = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "err-gif-001"},
        files=[("images", ("anim.gif", gif_buf.getvalue(), "image/gif"))],
    )
    assert gif_resp.status_code == 415
    assert gif_resp.json()["error"]["code"] == "UNSUPPORTED_IMAGE_TYPE"

    # 5. Oversized file -> 413 PAYLOAD_TOO_LARGE
    from app.services import images as images_mod

    fake_settings = Settings(max_upload_mb=1)
    monkeypatch.setattr(images_mod, "get_settings", lambda: fake_settings)
    oversized = b"x" * (1024 * 1024 + 500)
    big_resp = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "err-big-001"},
        files=[("images", ("huge.jpg", oversized, "image/jpeg"))],
    )
    assert big_resp.status_code == 413
    assert big_resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"

    # 6. Location coordinates without consent -> 422
    no_consent = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={
            "idempotency_key": "err-loc-001",
            "latitude": "30.26",
            "longitude": "-97.74",
            "location_consent": "false",
        },
        files=[("images", ("ok.jpg", valid_jpeg, "image/jpeg"))],
    )
    assert no_consent.status_code == 422

    # Delivery is STILL ASSIGNED (none of the failed completions altered its status)
    check = client.get(f"/api/v1/deliveries/{did}").json()
    assert check["status"] == "ASSIGNED"
    assert check["proof_count"] == 0


def test_invalid_delivery_id_and_wrong_driver_rejected(client, users):
    d = _create_assigned_delivery(client, str(users["driver1"].id))
    did = d["id"]
    img = make_image_bytes()

    # Wrong driver (driver2)
    login_as(client, "driver2@prooftrack.test")
    wrong = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "wrong-driver-001"},
        files=[("images", ("pod.jpg", img, "image/jpeg"))],
    )
    assert wrong.status_code == 403

    # Nonexistent delivery ID
    login_as(client, "driver1@prooftrack.test")
    missing = client.post(
        f"/api/v1/deliveries/{uuid.uuid4()}/complete",
        data={"idempotency_key": "missing-deliv-001"},
        files=[("images", ("pod.jpg", img, "image/jpeg"))],
    )
    assert missing.status_code == 404


def test_idempotency_and_storage_failure_rollback(client, db, memory_storage, users):
    d = _create_assigned_delivery(client, str(users["driver1"].id))
    did = d["id"]
    img1 = make_image_bytes("JPEG", (400, 300), (10, 20, 30))
    img2 = make_image_bytes("JPEG", (400, 300), (200, 100, 50))

    login_as(client, "driver1@prooftrack.test")

    # Inject storage failure after the first object (original written, preview fails)
    memory_storage.fail_after_n_puts = 1
    fail_resp = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "idem-retry-key-001"},
        files=[("images", ("pod1.jpg", img1, "image/jpeg"))],
    )
    assert fail_resp.status_code == 503
    assert fail_resp.json()["error"]["code"] == "STORAGE_UNAVAILABLE"

    # Partial object was cleaned up and delivery is NOT marked DELIVERED
    assert len(memory_storage.objects) == 0
    assert client.get(f"/api/v1/deliveries/{did}").json()["status"] == "ASSIGNED"

    # Restore storage and retry with the EXACT SAME idempotency_key -> succeeds!
    memory_storage.fail_after_n_puts = None
    memory_storage.put_count = 0
    ok_resp = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "idem-retry-key-001"},
        files=[("images", ("pod1.jpg", img1, "image/jpeg"))],
    )
    assert ok_resp.status_code == 200
    assert ok_resp.json()["status"] == "DELIVERED"
    assert ok_resp.json()["proof_count"] == 1

    # Duplicate submission with same idempotency_key and same photo -> replays 200 without duplicating proof
    replay = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "idem-retry-key-001"},
        files=[("images", ("pod1.jpg", img1, "image/jpeg"))],
    )
    assert replay.status_code == 200
    assert replay.json()["proof_count"] == 1

    # Reusing the same idempotency_key with a DIFFERENT photo -> 409 IDEMPOTENCY_KEY_REUSED
    diff_photo = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "idem-retry-key-001"},
        files=[("images", ("pod2.jpg", img2, "image/jpeg"))],
    )
    assert diff_photo.status_code == 409
    assert diff_photo.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    # Repeated completion with a new idempotency key on an already DELIVERED delivery -> 409 INVALID_STATE
    second_complete = client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "idem-second-key-002"},
        files=[("images", ("pod2.jpg", img2, "image/jpeg"))],
    )
    assert second_complete.status_code == 409


def test_proof_access_control_flagging_and_admin_deletion(client, db, memory_storage, users):
    d = _create_assigned_delivery(client, str(users["driver1"].id))
    did = d["id"]
    img = make_image_bytes("JPEG", (600, 400), (50, 150, 220))

    login_as(client, "driver1@prooftrack.test")
    client.post(
        f"/api/v1/deliveries/{did}/complete",
        data={"idempotency_key": "proof-acl-001"},
        files=[("images", ("pod.jpg", img, "image/jpeg"))],
    )
    proof_id = client.get(f"/api/v1/deliveries/{did}/proofs").json()[0]["id"]

    # Owning driver can fetch thumbnail, preview, and original
    assert client.get(f"/api/v1/proofs/{proof_id}/thumbnail").status_code == 200
    assert client.get(f"/api/v1/proofs/{proof_id}/preview").status_code == 200
    orig_resp = client.get(f"/api/v1/proofs/{proof_id}/original?download=true")
    assert orig_resp.status_code == 200
    assert "attachment;" in orig_resp.headers.get("Content-Disposition", "")
    assert "private" in orig_resp.headers.get("Cache-Control", "")

    # Another driver (driver2) is FORBIDDEN from viewing proof
    login_as(client, "driver2@prooftrack.test")
    assert client.get(f"/api/v1/proofs/{proof_id}/thumbnail").status_code == 403
    assert client.get(f"/api/v1/proofs/{proof_id}/original").status_code == 403

    # Unauthenticated client is rejected with 401
    client.cookies.clear()
    assert client.get(f"/api/v1/proofs/{proof_id}/thumbnail").status_code == 401

    # Manager can view, flag, and resolve proof
    login_as(client, "manager@prooftrack.test")
    assert client.get(f"/api/v1/proofs/{proof_id}/original").status_code == 200

    flagged = client.post(
        f"/api/v1/proofs/{proof_id}/flag",
        json={"reason": "Package label not clearly visible in photo"},
    )
    assert flagged.status_code == 200
    assert flagged.json()["review_status"] == "FLAGGED"

    resolved = client.post(
        f"/api/v1/proofs/{proof_id}/resolve",
        json={"reason": "Recipient confirmed receipt by phone"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["review_status"] == "RESOLVED"

    # Manager cannot hard-delete or soft-delete proof (Admin only)
    assert client.request("DELETE", f"/api/v1/proofs/{proof_id}", json={"reason": "Attempt by manager"}).status_code == 403

    # Direct SQL mutation of proof sha256 or hard DELETE is blocked by trigger
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE delivery_proofs SET sha256 = 'tampered' WHERE id = :id"), {"id": proof_id})
        db.commit()
    db.rollback()

    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM delivery_proofs WHERE id = :id"), {"id": proof_id})
        db.commit()
    db.rollback()

    # Admin can perform audited soft deletion
    login_as(client, "admin@prooftrack.test")
    del_resp = client.request(
        "DELETE",
        f"/api/v1/proofs/{proof_id}",
        json={"reason": "Retention policy test deletion by admin"},
    )
    assert del_resp.status_code == 200
    assert len(memory_storage.objects) == 0


def test_orphan_reconciliation(client, db, memory_storage, users):
    d = _create_assigned_delivery(client, str(users["driver1"].id))
    orphan_key = "proofs/orphan/unreferenced.jpg"
    memory_storage.put(orphan_key, io.BytesIO(b"orphan-bytes"), content_type="image/jpeg", size=12)

    req = UploadRequest(
        id=uuid.uuid4(),
        user_id=users["driver1"].id,
        idempotency_key="abandoned-req-001",
        delivery_id=uuid.UUID(d["id"]),
        action="COMPLETE",
        fingerprint="fp",
        status="IN_PROGRESS",
        pending_object_keys=[orphan_key],
        attempts=1,
    )
    db.add(req)
    db.commit()

    stats = delivery_service.reconcile_orphans(db, memory_storage, older_than=timedelta(seconds=-10))
    assert stats["deleted"] == 1
    assert stats["stale_marked_failed"] == 1
    assert not memory_storage.exists(orphan_key)


def test_real_s3_minio_storage_integration():
    """Integration test against the real local MinIO S3 service on 127.0.0.1:9010."""
    s3_settings = Settings(
        storage_backend="s3",
        s3_endpoint_url="http://127.0.0.1:9010",
        s3_region="us-east-1",
        s3_bucket="prooftrack-proofs",
        s3_access_key="minioadmin",
        s3_secret_key="minioadmin",
        s3_addressing_style="path",
    )
    storage = S3Storage(s3_settings)
    storage.ensure_bucket()
    storage.check()

    key = f"test-integration/{uuid.uuid4()}/sample.jpg"
    payload = make_image_bytes("JPEG", (320, 240), (15, 85, 190))

    storage.put(key, io.BytesIO(payload), content_type="image/jpeg", size=len(payload))
    try:
        assert storage.exists(key) is True
        fetched = storage.get(key)
        assert fetched.content_length == len(payload)
        assert b"".join(fetched.body) == payload
    finally:
        storage.delete(key)
    assert storage.exists(key) is False
