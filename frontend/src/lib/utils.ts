import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";
import type { DeliveryStatus, EventType, FailureReason } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dtStr: string | null | undefined): string {
  if (!dtStr) return "—";
  try {
    return format(parseISO(dtStr), "MMM d, yyyy h:mm a");
  } catch {
    return dtStr;
  }
}

export function formatTimeWindow(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const fmt = (t: string) => {
    const [hStr, mStr] = t.split(":");
    const h = parseInt(hStr, 10);
    const m = mStr || "00";
    if (isNaN(h)) return t;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `After ${fmt(start)}`;
  if (end) return `By ${fmt(end)}`;
  return "Anytime";
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatFullAddress(d: {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  zip_code: string;
}): string {
  const parts = [d.address_line1];
  if (d.address_line2) parts.push(d.address_line2);
  parts.push(`${d.city}, ${d.state} ${d.zip_code}`);
  return parts.join(", ");
}

export function getGoogleMapsUrl(d: {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  zip_code: string;
}): string {
  const query = encodeURIComponent(
    `${d.address_line1}, ${d.city}, ${d.state} ${d.zip_code}`
  );
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function generateIdempotencyKey(prefix = "pod"): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

export const STATUS_META: Record<
  DeliveryStatus,
  {
    label: string;
    bg: string;
    text: string;
    border: string;
    dot: string;
  }
> = {
  PENDING: {
    label: "Pending",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  ASSIGNED: {
    label: "Assigned",
    bg: "bg-indigo-50",
    text: "text-indigo-800",
    border: "border-indigo-200",
    dot: "bg-indigo-500",
  },
  IN_TRANSIT: {
    label: "In Transit",
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
    dot: "bg-blue-600",
  },
  DELIVERED: {
    label: "Delivered",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    dot: "bg-emerald-600",
  },
  FAILED: {
    label: "Failed",
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
    dot: "bg-rose-600",
  },
  CANCELED: {
    label: "Canceled",
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-300",
    dot: "bg-slate-500",
  },
};

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  RECIPIENT_UNAVAILABLE: "Recipient Unavailable",
  INCORRECT_ADDRESS: "Incorrect or Incomplete Address",
  ACCESS_DENIED: "Access Denied / Gate Locked",
  RECIPIENT_REFUSED: "Recipient Refused Delivery",
  PACKAGE_DAMAGED: "Package Damaged in Transit",
  OTHER: "Other (Requires Explanation)",
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  CREATED: "Delivery Created",
  IMPORTED: "Imported via CSV",
  UPDATED: "Delivery Details Updated",
  ASSIGNED: "Driver Assigned",
  REASSIGNED: "Driver Reassigned",
  UNASSIGNED: "Driver Unassigned",
  STARTED: "Out for Delivery (In Transit)",
  DELIVERED: "Delivered with Proof",
  FAILED: "Delivery Attempt Failed",
  CANCELED: "Delivery Canceled",
  REOPENED: "Delivery Reopened",
  PROOF_FLAGGED: "Proof Flagged for Review",
  PROOF_REVIEW_RESOLVED: "Proof Investigation Resolved",
  PROOF_DELETED: "Proof Administratively Deleted",
};

export const US_STATES_LIST = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];
