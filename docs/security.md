# ProofTrack — Security & Compliance Architecture

## 1. Authentication & Session Security
- **Argon2id Password Hashing**: Passwords are hashed using `argon2-cffi` with automatic rehash-on-login if parameters are upgraded. Minimum password complexity (10+ characters, uppercase, lowercase, digit) is enforced on creation, reset, and change.
- **Opaque Server-Side Sessions**: Login issues a 32-byte cryptographically random token via `secrets.token_urlsafe(32)`. Only its `SHA-256` digest (`token_hash`) is stored in the `sessions` table.
- **Hardened Cookie Transport**: The session token is transmitted exclusively in an `HttpOnly`, `SameSite=Lax` cookie (`pt_session`), preventing XSS token theft.
- **Idle & Absolute Timeouts**: Every request validates both `expires_at` (absolute 24h window) and `last_seen_at` (idle 8h timeout). Password changes, password resets, and user deactivation immediately revoke active sessions.
- **Brute-Force Rate Limiting**: `login_attempts` enforces a sliding window lockout (`LOGIN_MAX_FAILURES=5` within `LOGIN_WINDOW_MINUTES=15`) per email and client IP.

## 2. CSRF Protection
- Every state-changing HTTP method (`POST`, `PATCH`, `PUT`, `DELETE`) requires an `X-CSRF-Token` header.
- Tokens are derived via `HMAC-SHA256(SECRET_KEY, session.token_hash)` and compared in constant time (`hmac.compare_digest`).

## 3. Strict Role-Based Access Control (RBAC) & Horizontal Isolation
- **Server-Side Enforcement**: Role checks (`require_admin`, `require_manager`, `require_driver`) execute on the server for every API route.
- **Horizontal Driver Isolation**: Drivers can only view, start, complete, fail, or view proofs for deliveries where `assigned_driver_id == current_user.id`. Accessing another driver's delivery or proof returns `403 Forbidden`.

## 4. Private Proof-of-Delivery Object Storage & Image Sanitization
- **Zero Public Bucket Access**: The S3/MinIO bucket (`prooftrack-proofs`) is configured with `mc anonymous set none`. Proof images are never stored as base64 strings in PostgreSQL and never exposed via unauthenticated URLs.
- **True Content Verification**: Uploaded files are streamed in bounded 64 KB chunks (`MAX_UPLOAD_MB=10`) while computing their `SHA-256` digest. Pillow + `pillow-heif` fully decode pixel data (`img.load()`) with `LOAD_TRUNCATED_IMAGES = False` and decompression bomb protection (`MAX_IMAGE_PIXELS = 50,000,000`). Renamed non-image files (e.g., `.exe` or `.svg` renamed to `.jpg`) are rejected with `422/415`.
- **EXIF Stripping**: Derived `preview.jpg` and `thumb.jpg` images are re-encoded purely from transposed RGB pixel buffers so embedded camera/GPS EXIF metadata is stripped from derived views.
- **Authenticated Streaming Proxy**: `/api/v1/proofs/{id}/thumbnail|preview|original` verifies session + role/ownership before streaming bytes with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

## 5. CSV Formula Injection Protection
- Exported CSV fields beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` are prefixed with a leading single quote (`'`) in `app/services/csv_io.py` to prevent spreadsheet formula execution when opened in Excel or Google Sheets.
