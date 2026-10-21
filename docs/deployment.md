# ProofTrack — Deployment & Operations Runbook

## 1. Containerized Stack (`docker-compose.yml`)

ProofTrack ships with a self-contained Docker Compose topology:
- **`db`**: PostgreSQL 16 Alpine with persistent volume `pg_data` and readiness healthcheck.
- **`minio`**: S3-compatible object storage with persistent volume `minio_data`.
- **`bucket-init`**: One-shot `mc` container that creates `prooftrack-proofs` and enforces `mc anonymous set none` (private access only).
- **`backend`**: Python 3.12 Slim container running `alembic upgrade head`, optional development seed (`SEED_ON_STARTUP`), and `uvicorn app.main:app`.
- **`frontend`**: Multi-stage build (Node 20 Alpine `npm run build` -> Nginx 1.27 Alpine serving static assets with SPA fallback and reverse-proxying `/api/` to `backend:8000`).

### Starting the Full Stack
```bash
cp .env.example .env
docker compose up --build -d
```

---

## 2. Production Hardening Checklist

`app/core/config.py` includes strict startup validation that **refuses to boot** when `ENVIRONMENT=production` if any of the following are insecure:
1. **`SECRET_KEY`**: Must be at least 32 characters and not match development defaults. Generate with:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
2. **`COOKIE_SECURE`**: Must be set to `true` so `pt_session` is transmitted only over TLS/HTTPS.
3. **`SEED_ON_STARTUP`**: Must be `false` in production (`app/services/seed.py` also refuses to run in production).
4. **Object Storage Credentials**: `S3_ACCESS_KEY` and `S3_SECRET_KEY` must not be `minioadmin` in production, and `DATABASE_URL` must use strong credentials.

---

## 3. Database Migrations & Administrative CLI

### Running Alembic Migrations
```bash
cd backend
alembic upgrade head
```

### Administrative CLI (`python -m app.cli`)
- `python -m app.cli check-db`: Verifies PostgreSQL connectivity.
- `python -m app.cli seed`: Idempotently seeds demo accounts, 30 US deliveries, and sample proof images (development/test only).
- `python -m app.cli reconcile`: Cleans up any orphaned S3 object keys recorded in `upload_requests` from interrupted uploads.
