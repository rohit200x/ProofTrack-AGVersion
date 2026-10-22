# Stage 1: Build the React + TypeScript Frontend
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: FastAPI Backend + Bundled React SPA
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STORAGE_BACKEND=memory \
    SEED_ON_STARTUP=true

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libheif1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy built React SPA into /app/static so FastAPI serves both UI and /api from one service
COPY --from=frontend-build /frontend/dist /app/static

EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]
