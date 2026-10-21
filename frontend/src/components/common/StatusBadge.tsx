import React, { useEffect } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Flag,
  ShieldCheck,
  Truck,
  UserCheck,
  X,
} from "lucide-react";
import type { DeliveryStatus, ProofReviewStatus } from "../../types";
import { cn, STATUS_META } from "../../lib/utils";

const STATUS_ICONS: Record<DeliveryStatus, React.ReactNode> = {
  PENDING: <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  ASSIGNED: <UserCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  IN_TRANSIT: <Truck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  DELIVERED: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  FAILED: <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  CANCELED: <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
};

export const StatusBadge: React.FC<{
  status: DeliveryStatus;
  size?: "sm" | "md";
  className?: string;
}> = ({ status, size = "md", className }) => {
  const meta = STATUS_META[status] || STATUS_META.PENDING;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium rounded-full border",
        meta.bg,
        meta.text,
        meta.border,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        className
      )}
    >
      {STATUS_ICONS[status]}
      <span>{meta.label}</span>
    </span>
  );
};

export const ProofReviewBadge: React.FC<{ status: ProofReviewStatus }> = ({
  status,
}) => {
  if (status === "FLAGGED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 border border-rose-200">
        <Flag className="w-3 h-3" />
        Flagged for Review
      </span>
    );
  }
  if (status === "RESOLVED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
        <ShieldCheck className="w-3 h-3" />
        Review Resolved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
      Verified
    </span>
  );
};

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}> = ({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = "max-w-lg",
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
    >
      <div
        className={cn(
          "bg-white rounded-xl shadow-2xl border border-slate-200 w-full overflow-hidden my-8",
          maxWidth
        )}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && (
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
