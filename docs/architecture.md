# ProofTrack — System Architecture & Data Model

## 1. High-Level Architecture

```
+-------------------------------------------------------------------+
|                        Browser / Mobile PWA                       |
|  - Driver Mobile View (/driver) + IndexedDB Offline Queue         |
|  - Manager Dispatch Console (/manager)                            |
|  - Admin Control Center (/admin)                                  |
+---------------------------------+---------------------------------+
                                  | HTTPS / Same-Origin Proxy (/api)
                                  | Cookie: pt_session (HttpOnly)
                                  | Header: X-CSRF-Token (HMAC)
                                  v
+-------------------------------------------------------------------+
|                   FastAPI Application Server                      |
|  - Auth, Session & RBAC Middleware (app/security/deps.py)         |
|  - Delivery Workflow & State Machine (app/services/delivery.py)   |
|  - Image Validation, EXIF Strip & Resize (app/services/images.py) |
|  - CSV Import/Export Engine (app/services/csv_io.py)              |
+-----------------+-------------------------------+-----------------+
                  | SQLAlchemy 2.0 (psycopg)      | boto3 S3 API
                  v                               v
+-----------------------------------+   +---------------------------+
|           PostgreSQL 16           |   |  Private S3 / MinIO       |
|  - users, sessions, login_attempts|   |  Bucket: prooftrack-proofs|
|  - deliveries, delivery_events    |   |  - .../original.<ext>     |
|  - delivery_proofs                |   |  - .../preview.jpg        |
|  - upload_requests, audit_logs    |   |  - .../thumb.jpg          |
|  - Integrity & Append-Only Trgs   |   |  (No public bucket access)|
+-----------------------------------+   +---------------------------+
```

---

## 2. Authoritative Delivery State Machine

```
            +-----------+
            |  PENDING  |
            +-----+-----+
                  | assign_driver()
                  v
            +-----------+
     +----->| ASSIGNED  |<----+
     |      +--+-----+--+     |
     |         |     |        |
     | start() |     | complete_delivery() (direct with proof)
     |         v     |        |
     |    +----------+--+     | reopen_delivery(reason)
     |    | IN_TRANSIT  |     |
     |    +---+------+--+     |
     |        |      |        |
     |        |      +--------+---+
     |        v                   v
     |  +-----------+       +-----------+
     |  | DELIVERED |       |  FAILED   |
     |  +-----------+       +-----+-----+
     |                            |
     +----------------------------+
          assign_driver()
```

### Enforced State Transition Rules
1. **`PENDING`**: Created without an assigned driver. Transitions to `ASSIGNED` when a driver is assigned, or `CANCELED`.
2. **`ASSIGNED`**: Assigned to an active `DRIVER`. Can transition to:
   - `IN_TRANSIT` when the assigned driver starts the stop (`POST /api/v1/deliveries/{id}/start`).
   - `DELIVERED` when the assigned driver completes the delivery with at least one verified proof photo (`POST /api/v1/deliveries/{id}/complete`).
   - `FAILED` when the assigned driver reports an exception (`POST /api/v1/deliveries/{id}/fail`).
   - `PENDING` if unassigned by a manager, or `CANCELED`.
3. **`IN_TRANSIT`**: Currently out for delivery. Can transition to `DELIVERED` (with committed proof), `FAILED` (with structured failure reason), or `CANCELED`.
4. **`DELIVERED` / `FAILED` / `CANCELED`**: Terminal states. Reopening into `ASSIGNED` or `PENDING` requires a manager/admin call to `POST /api/v1/deliveries/{id}/reopen` with a non-empty audit reason and emits an immutable `REOPENED` event.

---

## 3. Database Schema & Integrity Triggers

### Core Tables
- **`users`**: UUID primary key, `first_name`, `last_name`, `email` (unique, lowercase), `phone`, `role` (`ADMIN | MANAGER | DRIVER`), `password_hash` (Argon2id), `is_active`, `must_change_password`, `version`.
- **`sessions`**: `id`, `user_id`, `token_hash` (SHA-256 of raw cookie token), `ip_address`, `user_agent`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`.
- **`login_attempts`**: Tracks per-email and per-IP authentication attempts for sliding-window rate limiting.
- **`deliveries`**: Shipment record with `reference` (`PT-YYMM-NNNN`), `external_order_ref`, recipient contact, US address (`address_line1`, `address_line2`, `city`, `state`, `zip_code`, `country`), `scheduled_date`, `time_window_start`, `time_window_end`, `assigned_driver_id`, `status`, timestamps (`assigned_at`, `started_at`, `delivered_at`, `attempted_at`), `failure_reason`, `failure_notes`, `version` (optimistic locking).
- **`delivery_proofs`**: Metadata and storage pointers (`object_key`, `preview_key`, `thumbnail_key`, `sha256`, `content_type`, `size_bytes`, `width`, `height`, `location_consent`, `latitude`, `longitude`, `location_accuracy_m`, `review_status`, `review_reason`, `deleted_at`).
- **`delivery_events`**: Immutable operational event log (`event_type`, `from_status`, `to_status`, `actor_id`, `reason`, `details` JSONB, `created_at`).
- **`upload_requests`**: Tracks `idempotency_key`, `request_fingerprint`, `status` (`IN_PROGRESS | COMPLETED | FAILED`), `pending_object_keys`, and `response_snapshot` to guarantee idempotent retries and atomic storage cleanup.
- **`system_settings`** & **`audit_logs`**: Organization settings and security/compliance audit log.

### PostgreSQL Database-Level Integrity Guards (`0002_integrity_guards.py`)
1. **`trg_deliveries_delivered_requires_proof`**: Deferred constraint trigger on `deliveries` and `delivery_proofs` that aborts the transaction if a delivery is in `DELIVERED` status at commit time without at least one non-deleted `DELIVERY` proof row.
2. **`trg_delivery_events_append_only`**: Blocks any `UPDATE` or `DELETE` on `delivery_events`.
3. **`trg_delivery_proofs_immutable`**: Blocks modification of core cryptographic evidence columns (`delivery_id`, `object_key`, `sha256`, `size_bytes`, `width`, `height`, `uploaded_at`) after insertion.
