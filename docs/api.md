# ProofTrack — REST API Reference (`/api/v1`)

All endpoints are prefixed with `/api/v1`. Interactive OpenAPI documentation is served at `/api/docs` in development.

---

## 1. Authentication & CSRF Convention

- **Session Cookie**: `POST /api/v1/auth/login` sets an `HttpOnly`, `SameSite=Lax` cookie named `pt_session` and returns a session-bound `csrf_token` in the JSON body.
- **CSRF Header**: All state-changing requests (`POST`, `PATCH`, `PUT`, `DELETE`) except `/api/v1/auth/login` must supply the `X-CSRF-Token` header matching the active session.
- **Standard Error Envelope**:
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Human-readable explanation.",
      "details": [
        { "field": "zip_code", "message": "Invalid US ZIP code." }
      ]
    }
  }
  ```

---

## 2. Endpoints Summary

### Authentication (`/api/v1/auth`)
| Method | Path | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Public | Authenticate with `email` and `password`. Sets session cookie and returns `{ user, csrf_token }`. |
| `POST` | `/api/v1/auth/logout` | Any Authenticated | Revokes the current session and clears the cookie. |
| `GET` | `/api/v1/auth/me` | Any Authenticated | Returns the current authenticated user profile. |
| `GET` | `/api/v1/auth/csrf` | Any Authenticated | Returns `{ csrf_token }` for the active session. |
| `POST` | `/api/v1/auth/change-password` | Any Authenticated | Changes current user password (`current_password`, `new_password`) and rotates session. |

### Users & Drivers (`/api/v1/users`, `/api/v1/drivers`)
| Method | Path | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/users` | `ADMIN` | Paginated user list with `role`, `is_active`, and `search` filters. |
| `POST` | `/api/v1/users` | `ADMIN` | Provision a new `ADMIN`, `MANAGER`, or `DRIVER` account. |
| `GET` | `/api/v1/users/{id}` | `ADMIN` | Retrieve user details by UUID. |
| `PATCH` | `/api/v1/users/{id}` | `ADMIN` | Update user profile, role, or `is_active` status (deactivating revokes active sessions). |
| `POST` | `/api/v1/users/{id}/reset-password` | `ADMIN` | Sets temporary password, revokes sessions, and sets `must_change_password = true`. |
| `GET` | `/api/v1/drivers` | `MANAGER`, `ADMIN` | Lists active drivers for delivery assignment dropdowns. |

### Deliveries & Dispatch (`/api/v1/deliveries`)
| Method | Path | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/deliveries` | `MANAGER`, `ADMIN` | Paginated list with filters: `status`, `driver_id`, `unassigned`, `overdue`, `has_proof`, `date_from`, `date_to`, `search`, `sort_field`, `sort_dir`. |
| `POST` | `/api/v1/deliveries` | `MANAGER`, `ADMIN` | Create a new delivery (optionally pre-assigning a driver). |
| `GET` | `/api/v1/deliveries/{id}` | `MANAGER`, `ADMIN`, Assigned `DRIVER` | Fetch full delivery record. Drivers may only access their own assigned deliveries. |
| `PATCH` | `/api/v1/deliveries/{id}` | `MANAGER`, `ADMIN` | Update delivery details with optimistic concurrency (`version`). |
| `POST` | `/api/v1/deliveries/{id}/assign` | `MANAGER`, `ADMIN` | Assign or reassign an active driver (`driver_id`, optional `scheduled_date`, `reason`). |
| `POST` | `/api/v1/deliveries/{id}/unassign` | `MANAGER`, `ADMIN` | Unassign driver and return delivery to `PENDING`. |
| `POST` | `/api/v1/deliveries/{id}/start` | Assigned `DRIVER` | Mark delivery `IN_TRANSIT`. |
| `POST` | `/api/v1/deliveries/{id}/complete` | Assigned `DRIVER` | Multipart form upload (`images` 1..5 files, `idempotency_key`, optional `recipient_name`, `driver_notes`, GPS fields). Atomically stores proofs and marks `DELIVERED`. |
| `POST` | `/api/v1/deliveries/{id}/fail` | Assigned `DRIVER` | Multipart form (`reason`, `notes`, `idempotency_key`, optional `image`). Marks delivery `FAILED`. |
| `POST` | `/api/v1/deliveries/{id}/reopen` | `MANAGER`, `ADMIN` | Reopen a `DELIVERED`, `FAILED`, or `CANCELED` delivery with mandatory `reason`. |
| `POST` | `/api/v1/deliveries/{id}/cancel` | `MANAGER`, `ADMIN` | Cancel a non-delivered shipment. |
| `GET` | `/api/v1/deliveries/{id}/events` | Authorized Role | Chronological audit events for the delivery. |
| `GET` | `/api/v1/deliveries/{id}/proofs` | Authorized Role | List committed proof metadata records for the delivery. |
| `GET` | `/api/v1/deliveries/import-template` | `MANAGER`, `ADMIN` | Download UTF-8 CSV import template. |
| `POST` | `/api/v1/deliveries/import` | `MANAGER`, `ADMIN` | Bulk CSV import (`dry_run=true` for preview, `dry_run=false` to commit). |
| `GET` | `/api/v1/deliveries/export` | `MANAGER`, `ADMIN` | Stream filtered deliveries as a UTF-8 CSV download (formula-injection escaped). |

### Driver Portal (`/api/v1/driver`)
| Method | Path | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/driver/deliveries` | `DRIVER` | Lists deliveries assigned strictly to the authenticated driver (`date`, `status`, `search`, `include_overdue`). |
| `GET` | `/api/v1/driver/history` | `DRIVER` | Paginated history of `DELIVERED` and `FAILED` stops for the authenticated driver. |

### Proof Images & Review (`/api/v1/proofs`)
| Method | Path | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/proofs/{id}/thumbnail` | Authorized Role | Streams derived thumbnail JPEG (`Cache-Control: private, no-store`). |
| `GET` | `/api/v1/proofs/{id}/preview` | Authorized Role | Streams derived 1600px preview JPEG (`Cache-Control: private, no-store`). |
| `GET` | `/api/v1/proofs/{id}/original` | Authorized Role | Streams original verified proof image (`?download=true` for attachment). |
| `POST` | `/api/v1/proofs/{id}/flag` | `MANAGER`, `ADMIN` | Flag a proof photo for investigation with `reason`. |
| `POST` | `/api/v1/proofs/{id}/resolve` | `MANAGER`, `ADMIN` | Resolve a flagged proof investigation with `reason`. |
| `DELETE` | `/api/v1/proofs/{id}` | `ADMIN` | Administratively soft-delete a proof (blocked if it is the sole proof keeping a delivery `DELIVERED`). |

### Dashboard, Settings & Health
| Method | Path | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/dashboard/summary` | `MANAGER`, `ADMIN` | KPI counters, completion rate, and business timezone definitions. |
| `GET` | `/api/v1/dashboard/attention` | `MANAGER`, `ADMIN` | Triage buckets (`overdue`, `recent_failures`, `flagged`, `unassigned_today`, `recently_completed`). |
| `GET` | `/api/v1/dashboard/activity` | `MANAGER`, `ADMIN` | Paginated global audit event stream. |
| `GET` | `/api/v1/settings` | Authenticated | Retrieve organization settings and upload limits. |
| `PATCH` | `/api/v1/settings` | `ADMIN` | Update `organization_name`, `business_timezone`, or `proof_retention_days`. |
| `POST` | `/api/v1/settings/reconcile-storage` | `ADMIN` | Reconcile and purge orphaned S3 objects from interrupted uploads. |
| `GET` | `/api/v1/health` | Public | Liveness probe (`{"status": "ok"}`). |
| `GET` | `/api/v1/ready` | Public | Readiness probe verifying PostgreSQL and S3 bucket connectivity. |
