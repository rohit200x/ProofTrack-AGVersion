"""CLI entrypoint for administrative tasks (seed data, DB check, orphan reconciliation)."""

import sys
from datetime import timedelta


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m app.cli <command>")
        print("Commands: seed, check-db, reconcile")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "seed":
        from app.core.config import get_settings
        from app.db.session import SessionLocal
        from app.services.seed import seed

        s = get_settings()
        if s.is_production:
            print("ERROR: Seed data cannot be loaded in production.")
            sys.exit(1)

        with SessionLocal() as db:
            seed(db)

    elif cmd == "check-db":
        import sqlalchemy
        from app.db.session import engine

        with engine.connect() as conn:
            conn.execute(sqlalchemy.text("SELECT 1"))
            print("Database connection OK")

    elif cmd == "reconcile":
        from app.db.session import SessionLocal
        from app.services.delivery import reconcile_orphans
        from app.storage.base import get_storage

        with SessionLocal() as db:
            stats = reconcile_orphans(db, get_storage(), older_than=timedelta(seconds=0))
            print(f"Reconciled storage: {stats}")

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
