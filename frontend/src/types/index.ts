export type Role = "ADMIN" | "MANAGER" | "DRIVER";

export type DeliveryStatus =
  | "PENDING"
  | "ASSIGNED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELED";

export type FailureReason =
  | "RECIPIENT_UNAVAILABLE"
  | "INCORRECT_ADDRESS"
  | "ACCESS_DENIED"
  | "RECIPIENT_REFUSED"
  | "PACKAGE_DAMAGED"
  | "OTHER";

export type EventType =
  | "CREATED"
  | "IMPORTED"
  | "UPDATED"
  | "ASSIGNED"
  | "REASSIGNED"
  | "UNASSIGNED"
  | "STARTED"
  | "DELIVERED"
  | "FAILED"
  | "CANCELED"
  | "REOPENED"
  | "PROOF_FLAGGED"
  | "PROOF_REVIEW_RESOLVED"
  | "PROOF_DELETED";

export type ProofKind = "DELIVERY" | "FAILED_ATTEMPT";
export type ProofReviewStatus = "NONE" | "FLAGGED" | "RESOLVED";

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  phone: string | null;
  is_active: boolean;
  must_change_password: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserBrief {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  role?: string | null;
}

export interface DriverBrief {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Delivery {
  id: string;
  reference: string;
  external_order_ref: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  scheduled_date: string;
  time_window_start: string | null;
  time_window_end: string | null;
  instructions: string | null;
  assigned_driver_id: string | null;
  status: DeliveryStatus;
  manager_notes: string | null;
  driver_notes: string | null;
  failure_reason: FailureReason | null;
  failure_notes: string | null;
  recipient_name_confirmed: string | null;
  assigned_at: string | null;
  started_at: string | null;
  delivered_at: string | null;
  attempted_at: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  assigned_driver: UserBrief | null;
  proof_count: number;
  flagged_count: number;
}

export interface DeliveryEvent {
  id: string;
  delivery_id: string;
  actor_id: string | null;
  actor: UserBrief | null;
  event_type: EventType;
  from_status: DeliveryStatus | null;
  to_status: DeliveryStatus | null;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: string;
  delivery_reference: string | null;
}

export interface Proof {
  id: string;
  delivery_id: string;
  uploader_id: string | null;
  uploader: UserBrief | null;
  kind: ProofKind;
  content_type: string;
  size_bytes: number;
  width: number;
  height: number;
  uploaded_at: string;
  location_consent: boolean;
  latitude: string | number | null;
  longitude: string | number | null;
  location_accuracy_m: string | number | null;
  review_status: ProofReviewStatus;
  review_reason: string | null;
  reviewed_by: UserBrief | null;
  reviewed_at: string | null;
  sha256: string;
  original_filename: string | null;
}

export interface DashboardSummary {
  total: number;
  pending: number;
  assigned: number;
  in_transit: number;
  delivered: number;
  failed: number;
  canceled: number;
  overdue: number;
  completion_pct: number;
  business_today: string | null;
  business_timezone: string | null;
  definitions: Record<string, string>;
}

export interface DashboardAttention {
  overdue: Delivery[];
  recent_failures: Delivery[];
  recently_completed: Delivery[];
  flagged: Delivery[];
  unassigned_today: Delivery[];
}

export interface ActivityResponse {
  events: DeliveryEvent[];
  total: number;
}

export interface CsvPreviewRow {
  row: number;
  reference: string;
  recipient_name: string;
  address_line1: string;
  city: string;
  state: string;
  zip_code: string;
  scheduled_date: string;
  driver_email: string | null;
  valid: boolean;
  errors: string[];
}

export interface CsvImportResult {
  dry_run: boolean;
  created: number;
  created_references?: string[];
  valid_rows: number;
  invalid_rows: number;
  total_rows: number;
  columns: string[];
  errors: Array<{ row: number; reference: string | null; errors: string[] }>;
  preview: CsvPreviewRow[];
}

export interface AppSettings {
  business_timezone: string;
  proof_retention_days: number;
  organization_name: string;
  max_upload_mb: number;
  max_proof_photos: number;
  supported_timezones: string[];
}
