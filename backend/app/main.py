"""ProofTrack FastAPI application factory and entry point."""

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import configure_logging, request_id_var

log = logging.getLogger("prooftrack")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    log.info("startup", extra={"environment": s.environment})
    if s.s3_create_bucket:
        try:
            from app.storage.base import get_storage
            get_storage().ensure_bucket()
            log.info("storage_bucket_ensured")
        except Exception:
            log.warning("storage_bucket_init_failed", exc_info=True)
    if s.seed_on_startup and not s.is_production and s.environment != "test":
        try:
            from app.db.session import SessionLocal
            from app.services.seed import seed
            with SessionLocal() as db:
                seed(db)
        except Exception:
            log.warning("startup_seed_failed", exc_info=True)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)

    app = FastAPI(
        title="ProofTrack API",
        description="Logistics Delivery Management & Proof of Delivery",
        version="1.0.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # --- Middleware ---

    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:3000",
    ] + settings.cors_origin_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys(origins)),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-Id"],
        expose_headers=["X-Request-Id"],
    )

    if settings.trusted_host_list != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_host_list)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id", uuid.uuid4().hex[:12])
        request_id_var.set(rid)
        response: Response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), camera=(self)"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response

    # --- Error handlers ---

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        body = {"error": {"code": exc.code, "message": exc.message}}
        if exc.details:
            body["error"]["details"] = exc.details
        resp = JSONResponse(body, status_code=exc.status_code)
        if exc.headers:
            for k, v in exc.headers.items():
                resp.headers[k] = v
        return resp

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        details = []
        for err in exc.errors():
            loc = [str(part) for part in err.get("loc", []) if part not in ("body", "query", "path", "form")]
            field = ".".join(loc) or "request"
            msg = err.get("msg", "Invalid value")
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, "):]
            details.append({"field": field, "message": msg})
        first_msg = details[0]["message"] if details else "Validation failed."
        return JSONResponse(
            {"error": {"code": "VALIDATION_ERROR", "message": first_msg, "details": details}},
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        log.exception("unhandled_error", extra={"path": str(request.url)})
        return JSONResponse(
            {"error": {"code": "INTERNAL_ERROR", "message": "An internal error occurred."}},
            status_code=500,
        )

    # --- Routes ---

    from app.api.v1.auth import router as auth_router
    from app.api.v1.dashboard import router as dashboard_router
    from app.api.v1.deliveries import router as deliveries_router
    from app.api.v1.driver import router as driver_router
    from app.api.v1.health import router as health_router
    from app.api.v1.proofs import router as proofs_router
    from app.api.v1.settings import router as settings_router
    from app.api.v1.users import drivers_router
    from app.api.v1.users import router as users_router

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(drivers_router)
    app.include_router(deliveries_router)
    app.include_router(driver_router)
    app.include_router(proofs_router)
    app.include_router(dashboard_router)
    app.include_router(settings_router)
    app.include_router(health_router)

    return app


app = create_app()
