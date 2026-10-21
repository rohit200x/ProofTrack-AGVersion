# ProofTrack — Engineering Architecture & Business Invariants (`AGENTS.md`)

## 1. Domain Overview
ProofTrack is a US logistics delivery management and proof-of-delivery (POD) web application with three server-enforced roles:
- **ADMIN**: User provisioning, role assignment, account activation/deactivation, password resets, organization settings, proof retention/deletion, and full operational oversight.
- **MANAGER**: Delivery creation, editing, CSV bulk import/export, driver assignment/reassignment, live dashboard monitoring, proof-of-delivery inspection/flagging, and exception reopening.
- **DRIVER**: Mobile-first interface restricted strictly to the driver's own assigned deliveries (`ASSIGNED`, `IN_TRANSIT`, and own history), status updates (`start`, `complete`, `fail`), camera/file photo capture, GPS coordinate consent, and offline pending-upload queue.

## 2. Non-Negotiable Business & Security Invariants
1. **DELIVERED Requires Committed Proof**: A delivery can **never** transition to `DELIVERED` unless at least one validated proof image (`kind = 'DELIVERY'`, `deleted_at IS NULL`) has been stored in private S3-compatible object storage and committed in `delivery_proofs` within the same transaction. Enforced in both `app/services/delivery.py` and PostgreSQL (`trg_deliveries_delivered_requires_proof`).
2. **Authoritative State Machine**:
   - `PENDING -> ASSIGNED | CANCELED`
   - `ASSIGNED -> IN_TRANSIT | DELIVERED | FAILED | PENDING | CANCELED`
   - `IN_TRANSIT -> DELIVERED | FAILED | CANCELED`
   - `FAILED -> ASSIGNED | CANCELED`
   - Exceptional reopening from `DELIVERED | FAILED | CANCELED` requires a documented reason and emits an append-only `REOPENED` audit event.
3. **Immutable Audit & Proof Evidence**:
   - `delivery_events` is append-only (`trg_delivery_events_append_only` blocks `UPDATE` and `DELETE`).
   - `delivery_proofs` core evidence columns (`object_key`, `sha256`, `uploaded_at`, etc.) are immutable (`trg_delivery_proofs_immutable`).
4. **Private Object Storage**:
   - Proof photos are never stored as database BLOBs or base64 strings, and buckets are never public.
   - Every thumbnail, preview, and original image request is authenticated and authorized by FastAPI (`/api/v1/proofs/{id}/...`).
5. **Session & CSRF Security**:
   - Opaque session tokens are stored only as SHA-256 hashes in `sessions` and transmitted via `HttpOnly` cookies (`pt_session`).
   - All state-changing requests (`POST`, `PATCH`, `DELETE`) verify the session-bound HMAC CSRF token in `X-CSRF-Token`.
   - Passwords are hashed with Argon2id (`argon2-cffi`).
6. **Offline Queue Truthfulness**:
   - Interrupted mobile submissions are queued in IndexedDB with their `idempotency_key` and image blobs.
   - Queued items are labeled **Pending Sync** on the device and never reported as `DELIVERED` until the server confirms completion.

## 3. Verification Expectations
- Schema changes must be expressed as Alembic migrations in `backend/alembic/versions/`.
- Backend changes must pass `pytest` in `backend/tests/`.
- Frontend changes must compile cleanly (`npm run build`) and pass Playwright end-to-end verification.
