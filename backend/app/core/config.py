"""Application configuration, loaded from environment variables (and an optional .env file)."""

from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRETS = {"", "change-me", "changeme", "secret", "dev-secret-change-me"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore", case_sensitive=False)

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_json: bool = True

    # --- database ---
    database_url: str = "postgresql+psycopg://prooftrack:prooftrack@127.0.0.1:5433/prooftrack"
    test_database_url: str = "postgresql+psycopg://prooftrack:prooftrack@127.0.0.1:5433/prooftrack_test"

    # --- security ---
    secret_key: str = "dev-secret-change-me"
    session_cookie_name: str = "pt_session"
    session_absolute_hours: int = 24
    session_idle_minutes: int = 120
    cookie_secure: bool | None = None  # None => secure only in production
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cors_origins: str = ""  # comma separated list of additional allowed origins
    trusted_hosts: str = "*"
    login_max_failures: int = 5
    login_window_minutes: int = 15
    login_max_failures_per_ip: int = 30
    password_min_length: int = 10

    # --- object storage (S3 compatible) ---
    storage_backend: Literal["s3", "memory"] = "s3"
    s3_endpoint_url: str | None = "http://127.0.0.1:9010"
    s3_region: str = "us-east-1"
    s3_bucket: str = "prooftrack-proofs"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_addressing_style: Literal["path", "virtual", "auto"] = "path"
    s3_create_bucket: bool = False  # development convenience; production buckets are provisioned separately

    # --- uploads ---
    max_upload_mb: int = 10
    max_proof_photos: int = 5
    max_image_side_px: int = 12000
    max_image_pixels: int = 64_000_000
    thumbnail_max_px: int = 800
    orphan_grace_minutes: int = 30

    # --- business ---
    business_timezone: str = "America/Chicago"
    proof_retention_days: int = 365
    organization_name: str = "ProofTrack Logistics"

    # --- development seed (only used by `python -m app.cli seed`) ---
    seed_on_startup: bool = False
    seed_admin_email: str = "admin@prooftrack.test"
    seed_manager_email: str = "manager@prooftrack.test"
    seed_driver_emails: str = "driver1@prooftrack.test,driver2@prooftrack.test,driver3@prooftrack.test"
    seed_password: str = "DemoPass2026!"

    @field_validator("cors_origins", "trusted_hosts", mode="before")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def use_secure_cookies(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        return [h.strip() for h in self.trusted_hosts.split(",") if h.strip()] or ["*"]

    @property
    def seed_driver_email_list(self) -> list[str]:
        return [e.strip() for e in self.seed_driver_emails.split(",") if e.strip()]

    @model_validator(mode="after")
    def _production_guards(self) -> "Settings":
        if self.is_production:
            problems = []
            if self.secret_key in INSECURE_SECRETS or len(self.secret_key) < 32:
                problems.append("SECRET_KEY must be a random value of at least 32 characters")
            if self.s3_access_key == "minioadmin" or self.s3_secret_key == "minioadmin":
                problems.append("Default MinIO credentials must not be used in production")
            if self.storage_backend != "s3":
                problems.append("STORAGE_BACKEND must be 's3' in production")
            if not self.use_secure_cookies:
                problems.append("Secure cookies must be enabled in production")
            if problems:
                raise ValueError("Unsafe production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
