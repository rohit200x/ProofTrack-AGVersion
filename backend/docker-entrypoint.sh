#!/bin/sh
set -e

echo "Applying Alembic database migrations..."
python -m alembic upgrade head

if [ "${SEED_ON_STARTUP:-false}" = "true" ] && [ "${ENVIRONMENT:-development}" != "production" ]; then
    echo "Seeding development data (idempotent)..."
    python -m app.cli seed
fi

exec "$@"
