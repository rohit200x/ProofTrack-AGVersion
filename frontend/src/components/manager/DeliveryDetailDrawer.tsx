import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  Flag,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserMinus,
  X,
} from "lucide-react";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../app/AuthContext";
import { Modal, ProofReviewBadge, StatusBadge } from "../common/StatusBadge";
import {
  EVENT_TYPE_LABELS,
  FAILURE_REASON_LABELS,
  formatBytes,
  formatDate,
  formatDateTime,
  formatFullAddress,
  formatTimeWindow,
  getGoogleMapsUrl,
  US_STATES_LIST,
} from "../../lib/utils";
import type { Delivery, FailureReason, Proof } from "../../types";

export const DeliveryDetailDrawer: React.FC<{
  deliveryId: string | null;
  onClose: () => void;
}> = ({ deliveryId, onClose }) => {
  const { user, toast } = useAuth();
  const queryClient = useQueryClient();

  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [assignReason, setAssignReason] = useState("");

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);

  // Reopen modal
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenDriverId, setReopenDriverId] = useState("");

  // Cancel modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Proof inspection / flag / resolve / delete modals
  const [inspectProof, setInspectProof] = useState<Proof | null>(null);
  const [flagModalProof, setFlagModalProof] = useState<Proof | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [resolveModalProof, setResolveModalProof] = useState<Proof | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [deleteModalProof, setDeleteModalProof] = useState<Proof | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const { data: delivery, isLoading } = useQuery({
    queryKey: ["delivery", deliveryId],
    queryFn: () => api.deliveries.get(deliveryId!),
    enabled: Boolean(deliveryId),
  });

  const { data: proofs = [] } = useQuery({
    queryKey: ["delivery-proofs", deliveryId],
    queryFn: () => api.deliveries.proofs(deliveryId!),
    enabled: Boolean(deliveryId),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["delivery-events", deliveryId],
    queryFn: () => api.deliveries.events(deliveryId!),
    enabled: Boolean(deliveryId),
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-active"],
    queryFn: () => api.users.drivers(true),
    enabled: Boolean(deliveryId),
  });

  useEffect(() => {
    if (delivery) {
      setSelectedDriverId(delivery.assigned_driver_id || "");
      setRescheduleDate(delivery.scheduled_date || "");
    }
  }, [delivery]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["delivery", deliveryId] });
    queryClient.invalidateQueries({ queryKey: ["delivery-proofs", deliveryId] });
    queryClient.invalidateQueries({ queryKey: ["delivery-events", deliveryId] });
    queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-attention"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-activity"] });
  };

  const assignMutation = useMutation({
    mutationFn: () =>
      api.deliveries.assign(deliveryId!, {
        driver_id: selectedDriverId,
        scheduled_date:
          rescheduleDate && rescheduleDate !== delivery?.scheduled_date
            ? rescheduleDate
            : undefined,
        reason: assignReason.trim() || undefined,
      }),
    onSuccess: (updated) => {
      toast({
        type: "success",
        title: "Driver assigned",
        description: `Assigned to ${updated.assigned_driver?.first_name} ${updated.assigned_driver?.last_name}.`,
      });
      setAssignReason("");
      refreshAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Assignment failed",
        description: err instanceof ApiError ? err.message : "Could not assign driver.",
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: () => api.deliveries.unassign(deliveryId!),
    onSuccess: () => {
      toast({ type: "info", title: "Driver unassigned" });
      refreshAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Could not unassign",
        description: err instanceof ApiError ? err.message : "Action failed.",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.deliveries.cancel(deliveryId!, cancelReason.trim() || undefined),
    onSuccess: () => {
      toast({ type: "info", title: "Delivery canceled" });
      setShowCancelModal(false);
      setCancelReason("");
      refreshAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Could not cancel delivery",
        description: err instanceof ApiError ? err.message : "Action failed.",
      });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () =>
      api.deliveries.reopen(deliveryId!, {
        reason: reopenReason.trim(),
        driver_id: reopenDriverId || null,
      }),
    onSuccess: () => {
      toast({
        type: "success",
        title: "Delivery reopened",
        description: "Delivery moved back into active workflow.",
      });
      setShowReopenModal(false);
      setReopenReason("");
      refreshAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Could not reopen delivery",
        description: err instanceof ApiError ? err.message : "Action failed.",
      });
    },
  });

  const flagMutation = useMutation({
    mutationFn: () => api.proofs.flag(flagModalProof!.id, flagReason.trim()),
    onSuccess: () => {
      toast({ type: "info", title: "Proof flagged for investigation" });
      setFlagModalProof(null);
      setFlagReason("");
      refreshAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Could not flag proof",
        description: err instanceof ApiError ? err.message : "Action failed.",
      });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      api.proofs.resolve(resolveModalProof!.id, resolveReason.trim()),
    onSuccess: () => {
      toast({ type: "success", title: "Proof review resolved" });
      setResolveModalProof(null);
      setResolveReason("");
      refreshAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Could not resolve proof flag",
        description: err instanceof ApiError ? err.message : "Action failed.",
      });
    },
  });

  const deleteProofMutation = useMutation({
    mutationFn: () =>
      api.proofs.delete(deleteModalProof!.id, deleteReason.trim()),
    onSuccess: () => {
      toast({ type: "info", title: "Proof deleted and audited" });
      setDeleteModalProof(null);
      setDeleteReason("");
      refreshAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Could not delete proof",
        description: err instanceof ApiError ? err.message : "Action failed.",
      });
    },
  });

  if (!deliveryId) return null;

  const canAssign =
    delivery &&
    ["PENDING", "ASSIGNED", "FAILED"].includes(delivery.status);
  const canEdit =
    delivery && !["DELIVERED", "CANCELED"].includes(delivery.status);
  const canReopen =
    delivery && ["DELIVERED", "FAILED", "CANCELED"].includes(delivery.status);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="delivery-detail-drawer"
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
        {/* Top Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          {delivery ? (
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    data-testid="drawer-delivery-reference"
                    className="font-mono text-sm font-bold text-slate-900"
                  >
                    {delivery.reference}
                  </span>
                  <StatusBadge status={delivery.status} />
                  <span className="text-[11px] text-slate-400 font-mono">
                    v{delivery.version}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Recipient: <strong>{delivery.recipient_name}</strong>
                </p>
              </div>
            </div>
          ) : (
            <div className="text-sm font-semibold text-slate-600">
              Loading delivery details...
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            data-testid="close-drawer-btn"
            aria-label="Close details drawer"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading || !delivery ? (
            <div className="space-y-4">
              <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />
              <div className="h-48 rounded-xl bg-slate-100 animate-pulse" />
            </div>
          ) : (
            <>
              {/* Operational Action Buttons Bar */}
              <div className="flex flex-wrap items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    data-testid="drawer-edit-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit Details
                  </button>
                )}

                {canReopen && (
                  <button
                    type="button"
                    onClick={() => {
                      setReopenDriverId(delivery.assigned_driver_id || "");
                      setShowReopenModal(true);
                    }}
                    data-testid="drawer-reopen-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reopen Delivery
                  </button>
                )}

                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    data-testid="drawer-cancel-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700"
                  >
                    <Ban className="w-3.5 h-3.5" /> Cancel Delivery
                  </button>
                )}
              </div>

              {/* Failure Alert Banner if FAILED */}
              {delivery.status === "FAILED" && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-900">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>
                      Failed Attempt:{" "}
                      {delivery.failure_reason
                        ? FAILURE_REASON_LABELS[
                            delivery.failure_reason as FailureReason
                          ] || delivery.failure_reason
                        : "Reported by driver"}
                    </span>
                  </div>
                  {delivery.failure_notes && (
                    <p className="text-xs text-rose-800 pl-6">
                      “{delivery.failure_notes}”
                    </p>
                  )}
                  <p className="text-[11px] text-rose-600 pl-6">
                    Attempted at {formatDateTime(delivery.attempted_at)}
                  </p>
                </div>
              )}

              {/* Driver Assignment Card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-blue-600" />
                    <span>Driver Assignment</span>
                  </h3>
                  {delivery.assigned_driver && (
                    <span className="text-xs font-semibold text-slate-800">
                      Current: {delivery.assigned_driver.first_name}{" "}
                      {delivery.assigned_driver.last_name}
                    </span>
                  )}
                </div>

                {canAssign ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Select Active Driver
                        </label>
                        <select
                          value={selectedDriverId}
                          onChange={(e) => setSelectedDriverId(e.target.value)}
                          data-testid="drawer-driver-select"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium"
                        >
                          <option value="">-- Choose driver --</option>
                          {drivers.map((drv) => (
                            <option key={drv.id} value={drv.id}>
                              {drv.first_name} {drv.last_name} ({drv.email})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Scheduled Date
                        </label>
                        <input
                          type="date"
                          value={rescheduleDate}
                          onChange={(e) => setRescheduleDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      {delivery.status === "ASSIGNED" ? (
                        <button
                          type="button"
                          onClick={() => unassignMutation.mutate()}
                          disabled={unassignMutation.isPending}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                        >
                          <UserMinus className="w-3.5 h-3.5" /> Unassign
                        </button>
                      ) : (
                        <div />
                      )}

                      <button
                        type="button"
                        disabled={!selectedDriverId || assignMutation.isPending}
                        onClick={() => assignMutation.mutate()}
                        data-testid="drawer-assign-btn"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        {assignMutation.isPending
                          ? "Assigning..."
                          : delivery.assigned_driver_id
                          ? "Update Assignment"
                          : "Assign Driver"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Driver assignment is locked while status is{" "}
                    <strong>{delivery.status}</strong>.
                  </p>
                )}
              </div>

              {/* Recipient, Destination & Timestamps Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                    Recipient & Destination
                  </div>
                  <div className="font-semibold text-slate-900 text-sm">
                    {delivery.recipient_name}
                  </div>
                  {delivery.recipient_phone && (
                    <div className="text-slate-600">{delivery.recipient_phone}</div>
                  )}
                  <div className="text-slate-700 flex items-start gap-1.5 pt-1">
                    <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>{formatFullAddress(delivery)}</span>
                  </div>
                  <a
                    href={getGoogleMapsUrl(delivery)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 font-semibold pt-1 hover:underline"
                  >
                    <span>View on Google Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-2">
                    Schedule & Key Timestamps
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Scheduled Date:</span>
                    <span className="font-semibold text-slate-900">
                      {formatDate(delivery.scheduled_date)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Time Window:</span>
                    <span className="font-semibold text-slate-900">
                      {formatTimeWindow(
                        delivery.time_window_start,
                        delivery.time_window_end
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Assigned At:</span>
                    <span className="text-slate-800">
                      {formatDateTime(delivery.assigned_at)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Started At:</span>
                    <span className="text-slate-800">
                      {formatDateTime(delivery.started_at)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Delivered At:</span>
                    <span
                      data-testid="drawer-delivered-at"
                      className="font-semibold text-emerald-700"
                    >
                      {formatDateTime(delivery.delivered_at)}
                    </span>
                  </div>
                  {delivery.recipient_name_confirmed && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Signed/Received By:</span>
                      <span className="font-semibold text-slate-900">
                        {delivery.recipient_name_confirmed}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes & Instructions */}
              {(delivery.instructions ||
                delivery.manager_notes ||
                delivery.driver_notes) && (
                <div className="rounded-xl border border-slate-200 p-4 space-y-2.5 text-xs">
                  {delivery.instructions && (
                    <div>
                      <span className="font-bold text-slate-600">
                        Delivery Instructions:{" "}
                      </span>
                      <span className="text-slate-800">
                        {delivery.instructions}
                      </span>
                    </div>
                  )}
                  {delivery.manager_notes && (
                    <div>
                      <span className="font-bold text-slate-600">
                        Internal Manager Notes:{" "}
                      </span>
                      <span className="text-slate-800">
                        {delivery.manager_notes}
                      </span>
                    </div>
                  )}
                  {delivery.driver_notes && (
                    <div>
                      <span className="font-bold text-emerald-700">
                        Driver Completion Notes:{" "}
                      </span>
                      <span className="text-slate-800">
                        {delivery.driver_notes}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Proof-of-Delivery Photographs Section */}
              <div
                data-testid="drawer-proofs-section"
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Camera className="w-4 h-4 text-blue-600" />
                    <span>
                      Proof-of-Delivery Photographs ({proofs.length})
                    </span>
                  </h3>
                </div>

                {proofs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                    No proof photographs have been uploaded for this delivery yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {proofs.map((p) => (
                      <div
                        key={p.id}
                        data-testid={`proof-card-${p.id}`}
                        className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex flex-col"
                      >
                        <button
                          type="button"
                          onClick={() => setInspectProof(p)}
                          data-testid={`open-proof-lightbox-${p.id}`}
                          className="relative aspect-4/3 bg-slate-950 overflow-hidden group"
                        >
                          <img
                            src={api.proofs.thumbnailUrl(p.id)}
                            alt="Proof of delivery thumbnail"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                          <span className="absolute bottom-2 right-2 px-2.5 py-1 rounded bg-black/75 text-white text-[11px] font-semibold">
                            Inspect Full Size
                          </span>
                        </button>

                        <div className="p-3 space-y-2 text-xs flex-1 flex flex-col justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <ProofReviewBadge status={p.review_status} />
                              <span className="text-[11px] font-mono text-slate-500">
                                {p.width}×{p.height} • {formatBytes(p.size_bytes)}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-600">
                              Uploaded {formatDateTime(p.uploaded_at)}
                              {p.uploader
                                ? ` by ${p.uploader.first_name} ${p.uploader.last_name}`
                                : ""}
                            </div>

                            {p.location_consent && p.latitude && p.longitude && (
                              <div className="text-[11px] text-emerald-700 font-mono">
                                GPS: {p.latitude}, {p.longitude}
                              </div>
                            )}

                            {p.review_reason && (
                              <div className="p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                                <strong>Review Note:</strong> {p.review_reason}
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2 flex-wrap">
                            <a
                              href={api.proofs.originalUrl(p.id, true)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
                            >
                              <Download className="w-3 h-3" /> Original
                            </a>

                            <div className="flex items-center gap-1.5">
                              {p.review_status !== "FLAGGED" ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFlagModalProof(p);
                                    setFlagReason("");
                                  }}
                                  data-testid={`flag-proof-btn-${p.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-[11px] font-semibold text-amber-900"
                                >
                                  <Flag className="w-3 h-3" /> Flag
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResolveModalProof(p);
                                    setResolveReason("");
                                  }}
                                  data-testid={`resolve-proof-btn-${p.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-semibold text-emerald-900"
                                >
                                  <ShieldCheck className="w-3 h-3" /> Resolve
                                </button>
                              )}

                              {user?.role === "ADMIN" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteModalProof(p);
                                    setDeleteReason("");
                                  }}
                                  className="p-1 rounded text-rose-600 hover:bg-rose-50"
                                  title="Admin Soft Delete Proof"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Complete Audit Event Timeline */}
              <div
                data-testid="drawer-events-timeline"
                className="space-y-3 pt-2 border-t border-slate-200"
              >
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span>Immutable Operational Audit Log ({events.length})</span>
                </h3>
                <div className="space-y-2.5">
                  {events.map((evt) => (
                    <div
                      key={evt.id}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs flex items-start justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900">
                          {EVENT_TYPE_LABELS[evt.event_type] || evt.event_type}
                          {evt.from_status && evt.to_status && (
                            <span className="ml-2 font-mono text-[11px] text-slate-500">
                              ({evt.from_status} → {evt.to_status})
                            </span>
                          )}
                        </div>
                        {evt.reason && (
                          <div className="text-slate-700">
                            Reason: “{evt.reason}”
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500">
                          Actor:{" "}
                          {evt.actor
                            ? `${evt.actor.first_name} ${evt.actor.last_name} (${evt.actor.role})`
                            : "System"}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">
                        {formatDateTime(evt.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Full-Size Proof Lightbox Modal */}
      <Modal
        open={Boolean(inspectProof)}
        onClose={() => setInspectProof(null)}
        title="Proof of Delivery Verification"
        description={
          inspectProof
            ? `SHA-256: ${inspectProof.sha256.slice(0, 24)}... • Uploaded ${formatDateTime(
                inspectProof.uploaded_at
              )}`
            : undefined
        }
        maxWidth="max-w-3xl"
      >
        {inspectProof && (
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center max-h-[65vh]">
              <img
                data-testid="lightbox-proof-image"
                src={api.proofs.previewUrl(inspectProof.id)}
                alt="Full size proof of delivery"
                className="max-h-[65vh] w-auto object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <div>
                Dimensions: {inspectProof.width}×{inspectProof.height}px •{" "}
                {formatBytes(inspectProof.size_bytes)} ({inspectProof.content_type})
              </div>
              <a
                href={api.proofs.originalUrl(inspectProof.id, true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold"
              >
                <Download className="w-3.5 h-3.5" /> Download Original
              </a>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Delivery Modal */}
      {delivery && (
        <EditDeliveryModal
          open={showEditModal}
          onClose={() => setShowEditModal(false)}
          delivery={delivery}
          onUpdated={refreshAll}
        />
      )}

      {/* Reopen Delivery Modal */}
      <Modal
        open={showReopenModal}
        onClose={() => setShowReopenModal(false)}
        title="Reopen Delivery"
        description="Move this finalized delivery back into active workflow. Existing proof evidence remains preserved in the audit log."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            reopenMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mandatory Reason for Reopening (min 5 characters)
            </label>
            <textarea
              rows={3}
              required
              minLength={5}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Explain why this delivery is being reopened..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Assign Driver (Optional — leave blank for PENDING)
            </label>
            <select
              value={reopenDriverId}
              onChange={(e) => setReopenDriverId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
            >
              <option value="">-- Leave Unassigned (PENDING) --</option>
              {drivers.map((drv) => (
                <option key={drv.id} value={drv.id}>
                  {drv.first_name} {drv.last_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowReopenModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={reopenMutation.isPending}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              {reopenMutation.isPending ? "Reopening..." : "Confirm Reopen"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Cancel Delivery Modal */}
      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancel Delivery"
        description="Canceled deliveries are removed from active driver routes."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cancelMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Cancellation Reason
            </label>
            <textarea
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Customer canceled order / duplicate shipment..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCancelModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold"
            >
              Keep Active
            </button>
            <button
              type="submit"
              disabled={cancelMutation.isPending}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
            >
              {cancelMutation.isPending ? "Canceling..." : "Confirm Cancellation"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Flag Proof Modal */}
      <Modal
        open={Boolean(flagModalProof)}
        onClose={() => setFlagModalProof(null)}
        title="Flag Proof for Investigation"
        description="Record why this proof photograph requires dispatcher review."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            flagMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Investigation Reason (min 5 characters)
            </label>
            <textarea
              rows={3}
              required
              minLength={5}
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              data-testid="flag-reason-textarea"
              placeholder="e.g. Photo is blurry or address number does not match..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFlagModalProof(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={flagMutation.isPending}
              data-testid="confirm-flag-proof-btn"
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              Flag Proof
            </button>
          </div>
        </form>
      </Modal>

      {/* Resolve Proof Flag Modal */}
      <Modal
        open={Boolean(resolveModalProof)}
        onClose={() => setResolveModalProof(null)}
        title="Resolve Proof Investigation"
        description="Record the resolution outcome for the audit trail."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            resolveMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Resolution Notes (min 5 characters)
            </label>
            <textarea
              rows={3}
              required
              minLength={5}
              value={resolveReason}
              onChange={(e) => setResolveReason(e.target.value)}
              placeholder="e.g. Confirmed delivery receipt directly with customer..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setResolveModalProof(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={resolveMutation.isPending}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              Resolve Investigation
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin Delete Proof Modal */}
      <Modal
        open={Boolean(deleteModalProof)}
        onClose={() => setDeleteModalProof(null)}
        title="Administrative Proof Deletion"
        description="Removes the stored image objects while preserving an audited tombstone record."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            deleteProofMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mandatory Deletion Reason (min 5 characters)
            </label>
            <textarea
              rows={3}
              required
              minLength={5}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. Privacy removal request / retention policy..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteModalProof(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleteProofMutation.isPending}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
            >
              Delete Proof Object
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

const EditDeliveryModal: React.FC<{
  open: boolean;
  onClose: () => void;
  delivery: Delivery;
  onUpdated: () => void;
}> = ({ open, onClose, delivery, onUpdated }) => {
  const { toast } = useAuth();
  const [recipientName, setRecipientName] = useState(delivery.recipient_name);
  const [recipientPhone, setRecipientPhone] = useState(
    delivery.recipient_phone || ""
  );
  const [address1, setAddress1] = useState(delivery.address_line1);
  const [address2, setAddress2] = useState(delivery.address_line2 || "");
  const [city, setCity] = useState(delivery.city);
  const [state, setState] = useState(delivery.state);
  const [zipCode, setZipCode] = useState(delivery.zip_code);
  const [scheduledDate, setScheduledDate] = useState(delivery.scheduled_date);
  const [instructions, setInstructions] = useState(delivery.instructions || "");
  const [managerNotes, setManagerNotes] = useState(delivery.manager_notes || "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRecipientName(delivery.recipient_name);
    setRecipientPhone(delivery.recipient_phone || "");
    setAddress1(delivery.address_line1);
    setAddress2(delivery.address_line2 || "");
    setCity(delivery.city);
    setState(delivery.state);
    setZipCode(delivery.zip_code);
    setScheduledDate(delivery.scheduled_date);
    setInstructions(delivery.instructions || "");
    setManagerNotes(delivery.manager_notes || "");
  }, [delivery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.deliveries.update(delivery.id, {
        recipient_name: recipientName,
        recipient_phone: recipientPhone || null,
        address_line1: address1,
        address_line2: address2 || null,
        city,
        state,
        zip_code: zipCode,
        scheduled_date: scheduledDate,
        instructions: instructions || null,
        manager_notes: managerNotes || null,
        version: delivery.version,
      });
      toast({ type: "success", title: "Delivery updated" });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update delivery.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit Delivery ${delivery.reference}`}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-3 text-xs">
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Recipient Name *
            </label>
            <input
              type="text"
              required
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Recipient Phone (US)
            </label>
            <input
              type="text"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Street Address *
            </label>
            <input
              type="text"
              required
              value={address1}
              onChange={(e) => setAddress1(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Suite / Apt
            </label>
            <input
              type="text"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              City *
            </label>
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              State *
            </label>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
            >
              {US_STATES_LIST.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              ZIP Code *
            </label>
            <input
              type="text"
              required
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Scheduled Date *
          </label>
          <input
            type="date"
            required
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Delivery Instructions
          </label>
          <textarea
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Internal Manager Notes
          </label>
          <textarea
            rows={2}
            value={managerNotes}
            onChange={(e) => setManagerNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
