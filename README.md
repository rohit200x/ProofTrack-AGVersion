# ProofTrack — Logistics Delivery Management & Proof of Delivery

**ProofTrack** is an enterprise-grade, full-stack US logistics delivery management and proof-of-delivery (POD) web application. It provides a mobile-first field portal for delivery drivers to capture and upload verified proof-of-delivery photographs, paired with a real-time centralized operations dashboard for dispatch managers and administrators.

---

## 1. Key Capabilities

### Field Driver Mobile Portal (`DRIVER`)
- **Mobile-First Route Queue**: View assigned deliveries filtered by today/overdue or status, with instant search by reference, recipient, street, or ZIP code.
- **One-Tap Navigation & Contact**: Direct integration with Google Maps navigation and click-to-call recipient phone links.
- **Camera & Photo Proof Upload**: Capture directly from the mobile camera (`capture="environment"`) or select up to 5 photos (`JPEG`, `PNG`, `WebP`, `HEIC`, up to 10 MB each) with client-side preview, retake/remove, and live upload progress.
- **Consent-Based GPS Tagging**: Optional browser geolocation capture recorded only with explicit driver consent at submission time.
- **Offline Pending Upload Queue**: Interrupted mobile submissions are persisted in IndexedDB with their `idempotency_key` and image blobs, labeled **Queued for Sync**, and never falsely marked `DELIVERED` until the server confirms completion.
- **Structured Exception Reporting**: Record failed delivery attempts (`RECIPIENT_UNAVAILABLE`, `ACCESS_DENIED`, `INCORRECT_ADDRESS`, `RECIPIENT_REFUSED`, `PACKAGE_DAMAGED`, `OTHER`) with optional supporting evidence photos.

### Operations & Dispatch Dashboard (`MANAGER`)
- **Live KPI Command Center**: Total deliveries, completion rate, delivered count, in-transit count, assigned count, pending unassigned count, failed attempts, and overdue open deliveries (calculated against the organization's configured US business timezone).
- **Dispatcher Attention Queues**: Instant triage tabs for Overdue, Recent Failures, Flagged Proofs, Unassigned Today, and Recently Completed deliveries.
- **Full Delivery Lifecycle Management**: Create deliveries, edit shipment details with optimistic concurrency (`version`), assign/reassign/unassign drivers, cancel shipments, and reopen terminal deliveries with mandatory audit reasons.
- **CSV Bulk Import & Export**: Download the UTF-8 CSV template, dry-run validate multi-row manifests with row-by-row error previews, commit batch imports, and export filtered delivery views to CSV.
- **Proof-of-Delivery Inspection & Flagging**: Inspect thumbnails, high-resolution previews, and original files streamed securely through FastAPI; verify SHA-256 hashes, dimensions, timestamps, and GPS coordinates; flag questionable proofs for investigation and resolve flags.

### System Administration (`ADMIN`)
- **User & Driver Provisioning**: Create, edit, activate/deactivate `ADMIN`, `MANAGER`, and `DRIVER` accounts; reset temporary passwords (automatically revoking active sessions and enforcing password change on next login).
- **Organization Settings & Storage Maintenance**: Configure organization name, US business timezone (`America/Chicago`, `America/New_York`, `America/Denver`, `America/Los_Angeles`, etc.), proof retention period, and run orphan S3 object reconciliation.

---

## 2. Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Backend API** | Python 3.12+, FastAPI, Pydantic v2, Uvicorn |
| **Database & ORM** | PostgreSQL 16, SQLAlchemy 2.0, Alembic (with PostgreSQL integrity triggers) |
| **Object Storage** | Private S3-compatible bucket (MinIO in local dev / AWS S3 in production) via `boto3` |
| **Image Processing** | Pillow + `pillow-heif` (real pixel decode, EXIF transpose & metadata stripping, thumbnail/preview generation) |
| **Authentication & Security** | `argon2-cffi` (Argon2id), opaque SHA-256 session tokens in `HttpOnly` cookies, HMAC-SHA256 CSRF protection |
| **Frontend SPA** | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query v5, React Router v6, Recharts, Lucide Icons |
| **Testing** | `pytest` + `httpx` (21 backend integration & security test suites) + Playwright (E2E browser tests) |

---

## 3. Quick Start

### Option A: Full Stack with Docker Compose
```bash
cp .env.example .env
docker compose up --build
```
- **Web Application**: `http://localhost:8080`
- **Backend API & Docs**: `http://localhost:8001/api/docs`
- **MinIO Console**: `http://localhost:9011` (`minioadmin` / `minioadmin`)

### Option B: Hybrid Local Development (Docker DB + MinIO, Host Backend + Frontend)
1. **Start PostgreSQL & MinIO**:
   ```bash
   docker compose up -d db minio bucket-init
   ```
2. **Run Backend Migrations, Seed Data & API Server**:
   ```bash
   cd backend
   python -m venv .venv
   # Windows: .\.venv\Scripts\activate | macOS/Linux: source .venv/bin/activate
   pip install -r requirements.txt -r requirements-dev.txt
   alembic upgrade head
   python -m app.cli seed
   uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
   ```
3. **Run Frontend Dev Server**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://127.0.0.1:3000`.

---

## 4. Development Demo Accounts

When `SEED_ON_STARTUP=true` (or after running `python -m app.cli seed` in development), the following accounts are available:

| Role | Email | Password | Portal Route |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@prooftrack.test` | `DemoPass2026!` | `/manager/dashboard` & `/admin/users` |
| **Dispatch Manager** | `manager@prooftrack.test` | `DemoPass2026!` | `/manager/dashboard` |
| **Field Driver 1** | `driver1@prooftrack.test` | `DemoPass2026!` | `/driver` |
| **Field Driver 2** | `driver2@prooftrack.test` | `DemoPass2026!` | `/driver` |
| **Field Driver 3** | `driver3@prooftrack.test` | `DemoPass2026!` | `/driver` |

---

## 5. Verification & Automated Tests

### Backend Integration & Security Suite (`pytest`)
```bash
cd backend
.\.venv\Scripts\pytest.exe -v
```
Runs 21 comprehensive tests against a real PostgreSQL test database (`prooftrack_test`) and S3/MinIO storage, verifying authentication, rate limiting, CSRF, RBAC, state machine rules, PostgreSQL triggers (`trg_deliveries_delivered_requires_proof`, `trg_delivery_events_append_only`, `trg_delivery_proofs_immutable`), multi-format image validation, idempotency, storage failure rollback, and CSV import/export.

### Frontend Production Build & Playwright E2E Suite
```bash
cd frontend
npm run build
npx playwright test
```

---

## 6. Documentation Index

- [Architecture & Data Model](docs/architecture.md)
- [REST API Reference](docs/api.md)
- [Security & Compliance Controls](docs/security.md)
- [User & Operations Guide](docs/user-guide.md)
- [Deployment & Operations Runbook](docs/deployment.md)
- [Testing & QA Verification Guide](docs/testing.md)
