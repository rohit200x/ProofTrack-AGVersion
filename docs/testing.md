# ProofTrack — Testing & QA Verification Guide

## 1. Backend Integration & Security Test Suite (`pytest`)

Located in `backend/tests/`, the backend suite executes **21 comprehensive integration tests** against a real PostgreSQL database (`prooftrack_test` with all Alembic migrations and triggers applied) and both an in-memory storage test double (with failure injection) and real MinIO S3 storage.

### Running Backend Tests
```bash
cd backend
.\.venv\Scripts\pytest.exe -v
```

### Test Coverage Breakdown
- **`test_auth_and_users.py` (8 tests)**:
  - Valid login, session cookie attributes, and `/api/v1/auth/me`
  - Brute-force login rate limiting (`429 Too Many Requests`)
  - Deactivated account login rejection & immediate mid-session revocation
  - Unauthenticated access rejection (`401`)
  - Session idle timeout & logout revocation
  - CSRF enforcement on mutations (`403` when missing or forged)
  - Role-based access control matrix (`ADMIN`, `MANAGER`, `DRIVER`)
  - Admin user creation, password reset (`must_change_password`), and forced password change flow
- **`test_deliveries_and_workflow.py` (4 tests)**:
  - Delivery creation and US address/ZIP/state/time-window validation
  - Driver assignment, reassignment, unassignment, and horizontal driver isolation (`403` on other driver's delivery)
  - Authoritative state machine transitions, optimistic concurrency (`409` on stale `version`), and manager reopen audit flow
  - PostgreSQL database triggers (`trg_deliveries_delivered_requires_proof`, `trg_delivery_events_append_only`, `trg_delivery_proofs_immutable`)
- **`test_proofs_and_storage.py` (7 tests)**:
  - Multi-format proof upload (`JPEG`, `PNG`, `WebP`, `HEIC`), thumbnail/preview generation, and SHA-256 verification
  - Rejection of empty files, oversized payloads (`413`), disguised executables/SVGs (`415/422`), and truncated/corrupted images
  - Prevention of unauthorized driver completing another driver's delivery
  - Idempotent retry handling (`idempotency_key`) and storage failure rollback (delivery remains `IN_TRANSIT` if S3 write fails)
  - Proof access control, manager flagging/resolution, and protection against deleting the sole proof of a `DELIVERED` shipment
  - Orphan S3 object reconciliation
  - Live MinIO S3 round-trip integration test
- **`test_csv_and_dashboard.py` (2 tests)**:
  - CSV template download, dry-run validation preview, batch import commit, and formula-safe CSV export
  - Dashboard KPI summary, attention queues, activity stream, and `/health` + `/ready` probes

---

## 2. Frontend Playwright End-to-End Test Suite

Located in `frontend/e2e/prooftrack.spec.ts`, the Playwright E2E suite tests the live browser application against the running FastAPI backend, PostgreSQL database, and MinIO object storage:

1. **Authentication & Route Guards**: Verifies unauthenticated users visiting `/manager/dashboard` are redirected to `/login` and invalid credentials display an accessible error alert.
2. **Complete Manager -> Driver -> Photo Upload -> Delivery Confirmation -> Manager Proof Inspection Workflow**:
   - Manager signs in, inspects Dashboard KPIs, creates a new delivery, and assigns it to `driver1@prooftrack.test`.
   - Driver signs in, verifies RBAC redirect if attempting `/manager/dashboard`, searches and opens the assigned delivery, clicks **Start Delivery (Mark In Transit)**, verifies client-side guard when submitting without a photo, attaches a valid PNG proof image, enters recipient confirmation & notes, and submits proof.
   - Verifies the delivery transitions to `DELIVERED` with the uploaded proof thumbnail rendered.
   - Manager signs back in, locates the delivery in the dispatch table, verifies `DELIVERED` status and `1 photo` badge, opens the inspection drawer, and opens the full-resolution proof verification lightbox.
3. **Administrator Workflow**: Verifies `admin@prooftrack.test` can manage users/drivers at `/admin/users` and run storage reconciliation at `/admin/settings`.

### Running Playwright E2E Tests
```bash
cd frontend
npx playwright test
```
