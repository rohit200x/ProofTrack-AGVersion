"""Engine and session factory."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=10,
    pool_recycle=1800,
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request. Services own commit/rollback boundaries."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
