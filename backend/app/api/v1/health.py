"""Health and readiness endpoints."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db.session import engine
from app.storage.base import get_storage, StorageError

router = APIRouter(prefix="/api/v1", tags=["Infrastructure"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/ready")
def ready():
    db_ok = True
    storage_ok = True
    try:
        with engine.connect() as conn:
            conn.execute(__import__("sqlalchemy").text("SELECT 1"))
    except Exception:
        db_ok = False
    try:
        get_storage().check()
    except (StorageError, Exception):
        storage_ok = False
    status = {"database": "ok" if db_ok else "error", "storage": "ok" if storage_ok else "error"}
    if db_ok and storage_ok:
        return {"status": "ready", **status}
    return JSONResponse({"status": "not_ready", **status}, status_code=503)
