"""Development seed data: users, 30 deliveries across US locations and dates, and sample proof images."""

import hashlib
import logging
import uuid
from datetime import date, time, timedelta
from decimal import Decimal
from io import BytesIO

from PIL import Image, ImageDraw
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Delivery, DeliveryEvent, DeliveryProof, User
from app.models.enums import (
    DeliveryStatus,
    EventType,
    FailureReason,
    ProofKind,
    ProofReviewStatus,
    Role,
)
from app.security.passwords import hash_password
from app.services import settings as settings_service
from app.storage.base import get_storage
from app.utils.common import utcnow

log = logging.getLogger("prooftrack.seed")

ADDRESSES = [
    {"recipient_name": "Alice Johnson", "recipient_phone": "+13125550101", "address_line1": "233 S Wacker Dr", "address_line2": "Suite 4400", "city": "Chicago", "state": "IL", "zip_code": "60606", "lat": "41.878876", "lng": "-87.635918"},
    {"recipient_name": "Robert Martinez", "recipient_phone": "+15125550102", "address_line1": "600 Congress Ave", "address_line2": "Floor 14", "city": "Austin", "state": "TX", "zip_code": "78701", "lat": "30.268153", "lng": "-97.742950"},
    {"recipient_name": "Carol Williams", "recipient_phone": "+12125550103", "address_line1": "350 Fifth Avenue", "address_line2": "Suite 3200", "city": "New York", "state": "NY", "zip_code": "10118", "lat": "40.748441", "lng": "-73.985664"},
    {"recipient_name": "David Kim", "recipient_phone": "+12065550104", "address_line1": "400 Broad St", "city": "Seattle", "state": "WA", "zip_code": "98109", "lat": "47.620506", "lng": "-122.349277"},
    {"recipient_name": "Emily Davis", "recipient_phone": "+14085550105", "address_line1": "10600 N Tantau Ave", "city": "Cupertino", "state": "CA", "zip_code": "95014", "lat": "37.334722", "lng": "-122.008889"},
    {"recipient_name": "Frank Miller", "recipient_phone": "+12135550106", "address_line1": "633 W Fifth St", "address_line2": "Lobby Desk", "city": "Los Angeles", "state": "CA", "zip_code": "90071", "lat": "34.051056", "lng": "-118.254389"},
    {"recipient_name": "Grace Lee", "recipient_phone": "+13035550107", "address_line1": "1801 California St", "city": "Denver", "state": "CO", "zip_code": "80202", "lat": "39.747800", "lng": "-104.989700"},
    {"recipient_name": "Henry Wilson", "recipient_phone": "+18165550108", "address_line1": "1200 Main St", "city": "Kansas City", "state": "MO", "zip_code": "64105", "lat": "39.099728", "lng": "-94.583067"},
    {"recipient_name": "Irene Taylor", "recipient_phone": "+16155550109", "address_line1": "150 Fourth Ave N", "address_line2": "Dock B", "city": "Nashville", "state": "TN", "zip_code": "37219", "lat": "36.163600", "lng": "-86.778200"},
    {"recipient_name": "Jack Anderson", "recipient_phone": "+16175550110", "address_line1": "200 Clarendon St", "city": "Boston", "state": "MA", "zip_code": "02116", "lat": "42.349200", "lng": "-71.075300"},
    {"recipient_name": "Karen Thomas", "recipient_phone": "+14045550111", "address_line1": "191 Peachtree St NE", "city": "Atlanta", "state": "GA", "zip_code": "30303", "lat": "33.758900", "lng": "-84.387900"},
    {"recipient_name": "Larry Jackson", "recipient_phone": "+16025550112", "address_line1": "2 N Central Ave", "city": "Phoenix", "state": "AZ", "zip_code": "85004", "lat": "33.448400", "lng": "-112.074000"},
    {"recipient_name": "Maria Garcia", "recipient_phone": "+13055550113", "address_line1": "1450 Brickell Ave", "address_line2": "Suite 1900", "city": "Miami", "state": "FL", "zip_code": "33131", "lat": "25.759200", "lng": "-80.191800"},
    {"recipient_name": "Nathan White", "recipient_phone": "+17185550114", "address_line1": "1 MetroTech Center", "city": "Brooklyn", "state": "NY", "zip_code": "11201", "lat": "40.693200", "lng": "-73.986600"},
    {"recipient_name": "Olivia Harris", "recipient_phone": "+12145550115", "address_line1": "2200 Ross Ave", "city": "Dallas", "state": "TX", "zip_code": "75201", "lat": "32.787600", "lng": "-96.798500"},
    {"recipient_name": "Peter Martin", "recipient_phone": "+13145550116", "address_line1": "1 Metropolitan Sq", "city": "Saint Louis", "state": "MO", "zip_code": "63102", "lat": "38.627500", "lng": "-90.191000"},
    {"recipient_name": "Quinn Robinson", "recipient_phone": "+17045550117", "address_line1": "100 N Tryon St", "city": "Charlotte", "state": "NC", "zip_code": "28202", "lat": "35.227100", "lng": "-80.843100"},
    {"recipient_name": "Rachel Clark", "recipient_phone": "+13125550118", "address_line1": "200 E Randolph St", "city": "Chicago", "state": "IL", "zip_code": "60601", "lat": "41.885300", "lng": "-87.621500"},
    {"recipient_name": "Steven Lewis", "recipient_phone": "+16125550119", "address_line1": "80 S Eighth St", "city": "Minneapolis", "state": "MN", "zip_code": "55402", "lat": "44.975900", "lng": "-93.272200"},
    {"recipient_name": "Tina Walker", "recipient_phone": "+15045550120", "address_line1": "701 Poydras St", "city": "New Orleans", "state": "LA", "zip_code": "70139", "lat": "29.950200", "lng": "-90.071500"},
]

INSTRUCTIONS = [
    "Leave parcel at front reception desk",
    "Ring bell twice; covered porch on left",
    "Call recipient on arrival at loading bay",
    "Deliver to Receiving Dock B (rear alley)",
    "Gate code #4412 — place inside parcel locker",
    "Hand directly to mailroom attendant",
    None,
    "Fragile medical supply carton — keep upright",
    "Check in with building security on ground floor",
    "Side entrance next to courtyard",
]

FAILURE_REASONS = [
    (FailureReason.RECIPIENT_UNAVAILABLE, "No answer at door or phone; left delivery notice."),
    (FailureReason.ACCESS_DENIED, "Security gate locked and keypad code did not open gate."),
    (FailureReason.INCORRECT_ADDRESS, "Suite number does not exist in building directory."),
    (FailureReason.RECIPIENT_REFUSED, "Recipient refused shipment citing duplicate order."),
]


def _render_proof_pair(
    reference: str,
    recipient: str,
    address: str,
    timestamp_str: str,
    *,
    accent: tuple[int, int, int] = (24, 98, 178),
) -> tuple[BytesIO, str, int, BytesIO, int]:
    width, height = 960, 720
    img = Image.new("RGB", (width, height), (242, 245, 250))
    draw = ImageDraw.Draw(img)
    # Header bar
    draw.rectangle([(0, 0), (width, 100)], fill=accent)
    draw.text((32, 26), "PROOFTRACK — VERIFIED DELIVERY EVIDENCE", fill=(255, 255, 255))
    draw.text((32, 56), f"Reference: {reference}", fill=(220, 235, 255))

    # Simulated parcel box at doorstep
    draw.rectangle([(120, 160), (width - 120, height - 180)], fill=(224, 229, 238), outline=(180, 190, 205), width=3)
    draw.rectangle([(270, 230), (width - 270, height - 220)], fill=(198, 152, 104), outline=(145, 105, 62), width=4)
    draw.line([(270, 340), (width - 270, 340)], fill=(235, 220, 190), width=14)
    draw.rectangle([(310, 265), (490, 325)], fill=(255, 255, 255), outline=(90, 90, 90), width=2)
    draw.text((324, 278), f"SHIP TO: {recipient[:22]}", fill=(20, 20, 20))
    draw.text((324, 298), f"TRACK: {reference}", fill=(40, 40, 40))

    # Footer metadata stamp
    draw.rectangle([(0, height - 120), (width, height)], fill=(15, 23, 42))
    draw.text((32, height - 96), f"Recipient: {recipient}   |   Address: {address}", fill=(241, 245, 249))
    draw.text((32, height - 64), f"Captured (UTC): {timestamp_str}", fill=(148, 163, 184))
    draw.text((32, height - 36), "Demo seed image — stored in private S3-compatible object storage", fill=(100, 116, 139))

    orig_buf = BytesIO()
    img.save(orig_buf, format="JPEG", quality=85, optimize=True)
    raw = orig_buf.getvalue()
    sha = hashlib.sha256(raw).hexdigest()
    orig_buf.seek(0)

    thumb_img = img.copy()
    thumb_img.thumbnail((480, 360), Image.Resampling.LANCZOS)
    thumb_buf = BytesIO()
    thumb_img.save(thumb_buf, format="JPEG", quality=80, optimize=True)
    thumb_size = len(thumb_buf.getvalue())
    thumb_buf.seek(0)
    return orig_buf, sha, len(raw), thumb_buf, thumb_size


def seed(db: Session) -> dict:
    """Create development seed data. Idempotent — skips if users already exist."""
    s = get_settings()
    if s.is_production:
        raise RuntimeError("Refusing to seed demonstration accounts in production.")

    existing = db.scalar(select(func.count()).select_from(User))
    if existing and existing > 0:
        if s.storage_backend == "memory":
            storage = get_storage()
            storage.ensure_bucket()
            proofs = db.scalars(select(DeliveryProof)).all()
            for idx, p in enumerate(proofs):
                if not storage.exists(p.object_key):
                    d = db.get(Delivery, p.delivery_id)
                    orig_buf, _, orig_size, thumb_buf, thumb_size = _render_proof_pair(
                        d.reference if d else "PT-SEED",
                        d.recipient_name if d else "Recipient",
                        f"{d.address_line1}, {d.city}, {d.state}" if d else "US",
                        p.uploaded_at.strftime("%Y-%m-%d %H:%M:%S UTC"),
                    )
                    raw_bytes = orig_buf.getvalue()
                    storage.put(p.object_key, BytesIO(raw_bytes), content_type="image/jpeg", size=orig_size)
                    if p.preview_key:
                        storage.put(p.preview_key, BytesIO(raw_bytes), content_type="image/jpeg", size=orig_size)
                    storage.put(p.thumbnail_key, thumb_buf, content_type="image/jpeg", size=thumb_size)
        log.info("seed_skip", extra={"reason": "Users already exist"})
        return {"skipped": True, "users": existing}

    log.info("seed_start")
    pwd = s.seed_password or "DemoPass2026!"
    pwd_hash = hash_password(pwd)

    admin = User(
        id=uuid.uuid4(),
        first_name="Elena",
        last_name="Vance",
        email=s.seed_admin_email.lower(),
        role=Role.ADMIN.value,
        phone="+13125550199",
        password_hash=pwd_hash,
        is_active=True,
        must_change_password=False,
    )
    manager = User(
        id=uuid.uuid4(),
        first_name="Marcus",
        last_name="Sterling",
        email=s.seed_manager_email.lower(),
        role=Role.MANAGER.value,
        phone="+13125550198",
        password_hash=pwd_hash,
        is_active=True,
        must_change_password=False,
    )

    driver_emails = s.seed_driver_email_list
    driver_profiles = [
        ("James", "Callahan", "+13125550181"),
        ("Maria", "Rodriguez", "+15125550182"),
        ("Devon", "Brooks", "+12065550183"),
    ]
    drivers: list[User] = []
    for i, email in enumerate(driver_emails[:3]):
        fn, ln, ph = driver_profiles[i] if i < len(driver_profiles) else (f"Driver{i+1}", "Fleet", f"+131255501{70+i:02d}")
        drivers.append(
            User(
                id=uuid.uuid4(),
                first_name=fn,
                last_name=ln,
                email=email.lower(),
                role=Role.DRIVER.value,
                phone=ph,
                password_hash=pwd_hash,
                is_active=True,
                must_change_password=False,
            )
        )
    db.add_all([admin, manager, *drivers])
    db.flush()

    today = settings_service.business_today(db)
    now = utcnow()
    storage = get_storage()
    storage.ensure_bucket()

    # 30 deliveries across statuses & dates:
    # 0..3: PENDING (2 today, 1 overdue, 1 tomorrow)
    # 4..10: ASSIGNED (today & yesterday across all 3 drivers, ensuring driver1 has several ready)
    # 11..14: IN_TRANSIT (today across drivers, including driver1)
    # 15..24: DELIVERED (10 completed deliveries with real proof objects stored in MinIO)
    # 25..27: FAILED (3 failed attempts with reasons)
    # 28..29: CANCELED (2 canceled deliveries)
    accents = [
        (24, 98, 178),
        (16, 122, 87),
        (79, 70, 229),
        (15, 118, 110),
        (30, 64, 175),
    ]

    deliveries: list[Delivery] = []
    proof_count = 0

    for i in range(30):
        addr = ADDRESSES[i % len(ADDRESSES)]
        instr = INSTRUCTIONS[i % len(INSTRUCTIONS)]
        ref = f"PT-2610-{1001 + i}"
        ext_ref = f"ORD-{88400 + i}"
        driver = drivers[i % len(drivers)]

        if i < 4:
            status = DeliveryStatus.PENDING.value
            sched = today + timedelta(days=[-1, 0, 0, 1][i])
            drv_id = None
            assigned_at = started_at = delivered_at = attempted_at = None
            rec_conf = fail_reason = fail_notes = mgr_notes = drv_notes = None
        elif i < 11:
            status = DeliveryStatus.ASSIGNED.value
            # Make sure driver 0 (driver1@prooftrack.test) gets plenty of today's assigned deliveries
            driver = drivers[0] if i in (4, 5, 6) else drivers[(i - 4) % len(drivers)]
            sched = today if i < 9 else today - timedelta(days=1)
            drv_id = driver.id
            assigned_at = now - timedelta(hours=4 + i)
            started_at = delivered_at = attempted_at = None
            rec_conf = fail_reason = fail_notes = drv_notes = None
            mgr_notes = "Priority commercial route" if i == 4 else None
        elif i < 15:
            status = DeliveryStatus.IN_TRANSIT.value
            driver = drivers[0] if i in (11, 12) else drivers[(i - 11) % len(drivers)]
            sched = today
            drv_id = driver.id
            assigned_at = now - timedelta(hours=5)
            started_at = now - timedelta(minutes=35 + (i - 11) * 15)
            delivered_at = attempted_at = None
            rec_conf = fail_reason = fail_notes = mgr_notes = drv_notes = None
        elif i < 25:
            status = DeliveryStatus.DELIVERED.value
            sched = today if i < 20 else today - timedelta(days=(i - 19))
            drv_id = driver.id
            assigned_at = now - timedelta(hours=18 + (i - 15) * 4)
            started_at = assigned_at + timedelta(hours=1)
            delivered_at = started_at + timedelta(minutes=42)
            attempted_at = delivered_at
            rec_conf = addr["recipient_name"]
            drv_notes = "Left parcel in secure reception area as instructed."
            fail_reason = fail_notes = mgr_notes = None
        elif i < 28:
            status = DeliveryStatus.FAILED.value
            sched = today if i == 25 else today - timedelta(days=1)
            drv_id = driver.id
            assigned_at = now - timedelta(hours=10 + (i - 25) * 6)
            started_at = assigned_at + timedelta(minutes=30)
            delivered_at = None
            attempted_at = started_at + timedelta(minutes=25)
            fr, fn = FAILURE_REASONS[(i - 25) % len(FAILURE_REASONS)]
            fail_reason = fr.value
            fail_notes = fn
            rec_conf = mgr_notes = drv_notes = None
        else:
            status = DeliveryStatus.CANCELED.value
            sched = today - timedelta(days=1)
            drv_id = None
            assigned_at = started_at = delivered_at = attempted_at = None
            rec_conf = fail_reason = fail_notes = drv_notes = None
            mgr_notes = "Order canceled by shipper prior to dispatch."

        delivery_id = uuid.uuid4()
        d = Delivery(
            id=delivery_id,
            reference=ref,
            external_order_ref=ext_ref,
            recipient_name=addr["recipient_name"],
            recipient_phone=addr.get("recipient_phone"),
            address_line1=addr["address_line1"],
            address_line2=addr.get("address_line2"),
            city=addr["city"],
            state=addr["state"],
            zip_code=addr["zip_code"],
            country="US",
            scheduled_date=sched,
            time_window_start=time(9, 0) if i % 2 == 0 else time(12, 0),
            time_window_end=time(13, 0) if i % 2 == 0 else time(17, 0),
            instructions=instr,
            assigned_driver_id=drv_id,
            status=status,
            manager_notes=mgr_notes,
            driver_notes=drv_notes,
            failure_reason=fail_reason,
            failure_notes=fail_notes,
            recipient_name_confirmed=rec_conf,
            assigned_at=assigned_at,
            started_at=started_at,
            delivered_at=delivered_at,
            attempted_at=attempted_at,
            created_by_id=manager.id,
            version=1,
        )
        db.add(d)
        db.flush()

        # Append-only audit events
        created_ts = assigned_at - timedelta(minutes=30) if assigned_at else now - timedelta(hours=6)
        db.add(DeliveryEvent(
            id=uuid.uuid4(),
            delivery_id=d.id,
            actor_id=manager.id,
            event_type=EventType.CREATED.value,
            to_status=DeliveryStatus.PENDING.value,
            created_at=created_ts,
        ))
        if drv_id:
            db.add(DeliveryEvent(
                id=uuid.uuid4(),
                delivery_id=d.id,
                actor_id=manager.id,
                event_type=EventType.ASSIGNED.value,
                from_status=DeliveryStatus.PENDING.value,
                to_status=DeliveryStatus.ASSIGNED.value,
                details={"driver_id": str(drv_id), "driver_name": driver.full_name},
                created_at=assigned_at or now,
            ))
        if status in (DeliveryStatus.IN_TRANSIT.value, DeliveryStatus.DELIVERED.value, DeliveryStatus.FAILED.value):
            db.add(DeliveryEvent(
                id=uuid.uuid4(),
                delivery_id=d.id,
                actor_id=drv_id,
                event_type=EventType.STARTED.value,
                from_status=DeliveryStatus.ASSIGNED.value,
                to_status=DeliveryStatus.IN_TRANSIT.value,
                created_at=started_at or now,
            ))
        if status == DeliveryStatus.DELIVERED.value:
            pid = uuid.uuid4()
            base_key = f"proofs/{d.id}/{pid}"
            orig_key = f"{base_key}/original.jpg"
            prev_key = f"{base_key}/preview.jpg"
            thumb_key = f"{base_key}/thumb.jpg"

            orig_buf, sha, orig_size, thumb_buf, thumb_size = _render_proof_pair(
                d.reference,
                d.recipient_name,
                f"{d.address_line1}, {d.city}, {d.state}",
                (delivered_at or now).strftime("%Y-%m-%d %H:%M:%S UTC"),
                accent=accents[i % len(accents)],
            )
            raw_bytes = orig_buf.getvalue()
            storage.put(orig_key, BytesIO(raw_bytes), content_type="image/jpeg", size=orig_size)
            storage.put(prev_key, BytesIO(raw_bytes), content_type="image/jpeg", size=orig_size)
            storage.put(thumb_key, thumb_buf, content_type="image/jpeg", size=thumb_size)

            flagged = i == 24
            db.add(DeliveryProof(
                id=pid,
                delivery_id=d.id,
                uploader_id=drv_id,
                kind=ProofKind.DELIVERY.value,
                object_key=orig_key,
                preview_key=prev_key,
                thumbnail_key=thumb_key,
                sha256=sha,
                content_type="image/jpeg",
                size_bytes=orig_size,
                width=960,
                height=720,
                original_filename=f"{d.reference.lower()}-pod.jpg",
                uploaded_at=delivered_at or now,
                location_consent=True,
                latitude=Decimal(addr["lat"]),
                longitude=Decimal(addr["lng"]),
                location_accuracy_m=Decimal("8.5"),
                review_status=ProofReviewStatus.FLAGGED.value if flagged else ProofReviewStatus.NONE.value,
                review_reason="Label partially obscured — verify suite number with recipient" if flagged else None,
                reviewed_by_id=manager.id if flagged else None,
                reviewed_at=now if flagged else None,
            ))
            proof_count += 1
            db.add(DeliveryEvent(
                id=uuid.uuid4(),
                delivery_id=d.id,
                actor_id=drv_id,
                event_type=EventType.DELIVERED.value,
                from_status=DeliveryStatus.IN_TRANSIT.value,
                to_status=DeliveryStatus.DELIVERED.value,
                details={"proof_ids": [str(pid)], "photo_count": 1, "recipient_name": rec_conf, "location_captured": True},
                created_at=delivered_at or now,
            ))
            if flagged:
                db.add(DeliveryEvent(
                    id=uuid.uuid4(),
                    delivery_id=d.id,
                    actor_id=manager.id,
                    event_type=EventType.PROOF_FLAGGED.value,
                    reason="Label partially obscured — verify suite number with recipient",
                    details={"proof_id": str(pid)},
                    created_at=now,
                ))
        elif status == DeliveryStatus.FAILED.value:
            db.add(DeliveryEvent(
                id=uuid.uuid4(),
                delivery_id=d.id,
                actor_id=drv_id,
                event_type=EventType.FAILED.value,
                from_status=DeliveryStatus.IN_TRANSIT.value,
                to_status=DeliveryStatus.FAILED.value,
                reason=fail_notes,
                details={"failure_reason": fail_reason},
                created_at=attempted_at or now,
            ))
        elif status == DeliveryStatus.CANCELED.value:
            db.add(DeliveryEvent(
                id=uuid.uuid4(),
                delivery_id=d.id,
                actor_id=manager.id,
                event_type=EventType.CANCELED.value,
                from_status=DeliveryStatus.PENDING.value,
                to_status=DeliveryStatus.CANCELED.value,
                reason=mgr_notes,
                created_at=now - timedelta(hours=3),
            ))

        deliveries.append(d)

    db.commit()
    summary = {"skipped": False, "users": 2 + len(drivers), "deliveries": len(deliveries), "proofs": proof_count}
    log.info("seed_complete", extra=summary)
    print(f"Seeded {summary['users']} users, {summary['deliveries']} deliveries, {summary['proofs']} proofs.")
    return summary
