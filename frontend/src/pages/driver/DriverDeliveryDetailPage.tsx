import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  ImagePlus,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Play,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../app/AuthContext";
import { Modal, ProofReviewBadge, StatusBadge } from "../../components/common/StatusBadge";
import { enqueuePendingSubmission } from "../../lib/offlineQueue";
import {
  EVENT_TYPE_LABELS,
  FAILURE_REASON_LABELS,
  formatBytes,
  formatDate,
  formatDateTime,
  formatFullAddress,
  formatTimeWindow,
  generateIdempotencyKey,
  getGoogleMapsUrl,
} from "../../lib/utils";
import type { FailureReason } from "../../types";

interface SelectedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const DriverDeliveryDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useAuth();
  const queryClient = useQueryClient();

  // POD Completion state
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [recipientConfirmed, setRecipientConfirmed] = useState("");
  const [driverNotes, setDriverNotes] = useState("");
  const [locationConsent, setLocationConsent] = useState(false);
  const [coords, setCoords] = useState<{
    lat: string;
    lng: string;
    acc: string;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [submittingPod, setSubmittingPod] = useState(false);
  const [podError, setPodError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    generateIdempotencyKey("pod")
  );
  const [completionBanner, setCompletionBanner] = useState<string | null>(null);

  // Failed attempt modal state
  const [showFailModal, setShowFailModal] = useState(false);
  const [failReason, setFailReason] = useState<FailureReason>("RECIPIENT_UNAVAILABLE");
  const [failNotes, setFailNotes] = useState("");
  const [failPhoto, setFailPhoto] = useState<File | null>(null);
  const [failError, setFailError] = useState<string | null>(null);
  const [submittingFail, setSubmittingFail] = useState(false);
  const [failIdemKey, setFailIdemKey] = useState(() =>
    generateIdempotencyKey("fail")
  );

  // Lightbox proof preview
  const [lightboxProofId, setLightboxProofId] = useState<string | null>(null);

  const {
    data: delivery,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["delivery", id],
    queryFn: () => api.deliveries.get(id!),
    enabled: Boolean(id),
  });

  const { data: proofs = [] } = useQuery({
    queryKey: ["delivery-proofs", id],
    queryFn: () => api.deliveries.proofs(id!),
    enabled: Boolean(id),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["delivery-events", id],
    queryFn: () => api.deliveries.events(id!),
    enabled: Boolean(id),
  });

  useEffect(() => {
    return () => {
      selectedPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, [selectedPhotos]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["delivery", id] });
    queryClient.invalidateQueries({ queryKey: ["delivery-proofs", id] });
    queryClient.invalidateQueries({ queryKey: ["delivery-events", id] });
    queryClient.invalidateQueries({ queryKey: ["driver-deliveries"] });
    queryClient.invalidateQueries({ queryKey: ["driver-history"] });
  };

  const startMutation = useMutation({
    mutationFn: () => api.deliveries.start(id!),
    onSuccess: () => {
      toast({
        type: "success",
        title: "Delivery started",
        description: "Status updated to In Transit.",
      });
      invalidateAll();
    },
    onError: (err) => {
      toast({
        type: "error",
        title: "Could not start delivery",
        description: err instanceof ApiError ? err.message : "Please try again.",
      });
    },
  });

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPodError(null);
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (selectedPhotos.length + files.length > 5) {
      setPodError("You can attach at most 5 proof-of-delivery photos.");
      e.target.value = "";
      return;
    }

    const next: SelectedPhoto[] = [];
    for (const file of files) {
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      const validMime =
        file.type.startsWith("image/") || ALLOWED_EXTENSIONS.includes(ext);
      if (!validMime) {
        setPodError(
          `Unsupported file "${file.name}". Please select a JPEG, PNG, WebP, or HEIC photo.`
        );
        e.target.value = "";
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setPodError(
          `Photo "${file.name}" (${formatBytes(
            file.size
          )}) exceeds the 10 MB limit.`
        );
        e.target.value = "";
        return;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setSelectedPhotos((prev) => [...prev, ...next]);
    // Reset idempotency key when photo selection changes
    setIdempotencyKey(generateIdempotencyKey("pod"));
    e.target.value = "";
  };

  const removePhoto = (photoId: string) => {
    setSelectedPhotos((prev) => {
      const target = prev.find((p) => p.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== photoId);
    });
    setIdempotencyKey(generateIdempotencyKey("pod"));
  };

  const captureGpsLocation = () => {
    if (!navigator.geolocation) {
      setPodError("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
          acc: pos.coords.accuracy.toFixed(1),
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setPodError(
          "Could not read GPS coordinates. You can still submit without location."
        );
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delivery) return;
    setPodError(null);

    if (selectedPhotos.length === 0) {
      setPodError(
        "At least one proof-of-delivery photo is required before completing this delivery."
      );
      return;
    }

    // If browser is offline, enqueue into IndexedDB for resilient sync
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueuePendingSubmission({
        idempotencyKey,
        deliveryId: delivery.id,
        deliveryReference: delivery.reference,
        recipientDisplay: delivery.recipient_name,
        action: "COMPLETE",
        images: selectedPhotos.map((p) => ({
          name: p.file.name,
          type: p.file.type || "image/jpeg",
          blob: p.file,
        })),
        recipientName: recipientConfirmed.trim() || undefined,
        driverNotes: driverNotes.trim() || undefined,
        latitude: locationConsent && coords ? coords.lat : undefined,
        longitude: locationConsent && coords ? coords.lng : undefined,
        locationAccuracyM: locationConsent && coords ? coords.acc : undefined,
        locationConsent,
        status: "QUEUED",
        createdAt: new Date().toISOString(),
      });
      toast({
        type: "info",
        title: "Saved to Offline Upload Queue",
        description:
          "Your proof photo is stored locally and will upload when connectivity returns.",
      });
      setCompletionBanner(
        "Queued offline — will complete automatically once your connection returns."
      );
      return;
    }

    setSubmittingPod(true);
    setUploadProgress(5);
    try {
      const fd = new FormData();
      fd.append("idempotency_key", idempotencyKey);
      for (const item of selectedPhotos) {
        fd.append("images", item.file, item.file.name);
      }
      if (recipientConfirmed.trim()) {
        fd.append("recipient_name", recipientConfirmed.trim());
      }
      if (driverNotes.trim()) {
        fd.append("driver_notes", driverNotes.trim());
      }
      if (locationConsent && coords) {
        fd.append("latitude", coords.lat);
        fd.append("longitude", coords.lng);
        fd.append("location_accuracy_m", coords.acc);
        fd.append("location_consent", "true");
      } else {
        fd.append("location_consent", "false");
      }

      await api.deliveries.complete(delivery.id, fd, (pct) =>
        setUploadProgress(pct)
      );

      setUploadProgress(100);
      setSelectedPhotos([]);
      setCompletionBanner(
        "Delivery completed! Proof of delivery has been verified and saved."
      );
      toast({
        type: "success",
        title: "Delivery Completed",
        description: `Proof uploaded for ${delivery.reference}.`,
      });
      invalidateAll();
    } catch (err) {
      if (err instanceof ApiError && err.code === "NETWORK_ERROR") {
        await enqueuePendingSubmission({
          idempotencyKey,
          deliveryId: delivery.id,
          deliveryReference: delivery.reference,
          recipientDisplay: delivery.recipient_name,
          action: "COMPLETE",
          images: selectedPhotos.map((p) => ({
            name: p.file.name,
            type: p.file.type || "image/jpeg",
            blob: p.file,
          })),
          recipientName: recipientConfirmed.trim() || undefined,
          driverNotes: driverNotes.trim() || undefined,
          latitude: locationConsent && coords ? coords.lat : undefined,
          longitude: locationConsent && coords ? coords.lng : undefined,
          locationAccuracyM: locationConsent && coords ? coords.acc : undefined,
          locationConsent,
          status: "QUEUED",
          createdAt: new Date().toISOString(),
        });
        toast({
          type: "info",
          title: "Connection lost — saved to Offline Queue",
          description: "Tap Sync Now in the top bar to retry.",
        });
      } else {
        setPodError(
          err instanceof ApiError
            ? err.message
            : "Upload failed. The delivery has NOT been marked delivered. Please retry."
        );
      }
    } finally {
      setSubmittingPod(false);
      setUploadProgress(null);
    }
  };

  const handleFailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delivery) return;
    setFailError(null);

    if (failReason === "OTHER" && !failNotes.trim()) {
      setFailError("Please enter notes describing the issue when selecting 'Other'.");
      return;
    }

    setSubmittingFail(true);
    try {
      const fd = new FormData();
      fd.append("reason", failReason);
      if (failNotes.trim()) fd.append("notes", failNotes.trim());
      fd.append("idempotency_key", failIdemKey);
      if (failPhoto) {
        fd.append("image", failPhoto, failPhoto.name);
      }

      await api.deliveries.fail(delivery.id, fd);
      setShowFailModal(false);
      toast({
        type: "info",
        title: "Failed attempt recorded",
        description: `Dispatch has been notified for ${delivery.reference}.`,
      });
      invalidateAll();
    } catch (err) {
      setFailError(
        err instanceof ApiError ? err.message : "Could not record failed attempt."
      );
    } finally {
      setSubmittingFail(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-44 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-64 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  if (isError || !delivery) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center space-y-3">
        <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="text-base font-bold text-slate-900">
          {error instanceof ApiError ? error.message : "Delivery not found"}
        </h2>
        <Link
          to="/driver"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" /> Back to My Deliveries
        </Link>
      </div>
    );
  }

  const isActive =
    delivery.status === "ASSIGNED" || delivery.status === "IN_TRANSIT";

  return (
    <div className="space-y-4">
      {/* Back navigation */}
      <div className="flex items-center justify-between">
        <Link
          to="/driver"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 py-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to My Deliveries</span>
        </Link>
        <span className="font-mono text-xs font-bold text-slate-500">
          {delivery.reference}
        </span>
      </div>

      {/* Completion Confirmation Banner */}
      {(completionBanner || delivery.status === "DELIVERED") && (
        <div
          data-testid="driver-delivery-completed-banner"
          className="rounded-2xl bg-emerald-900 text-white p-4 shadow-sm flex items-start gap-3"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold">
              {completionBanner || "Delivery Completed with Verified Proof"}
            </div>
            {delivery.delivered_at && (
              <div className="text-xs text-emerald-200 mt-0.5">
                Completed at {formatDateTime(delivery.delivered_at)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Primary Delivery Header Card */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-mono font-semibold text-blue-600">
              {delivery.reference}
              {delivery.external_order_ref
                ? ` • Order #${delivery.external_order_ref}`
                : ""}
            </div>
            <h1
              data-testid="driver-detail-recipient"
              className="text-xl font-bold text-slate-900 mt-0.5"
            >
              {delivery.recipient_name}
            </h1>
          </div>
          <StatusBadge status={delivery.status} />
        </div>

        {/* Address & Quick Actions */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
          <div className="flex items-start gap-2.5">
            <MapPin className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {delivery.address_line1}
              </div>
              {delivery.address_line2 && (
                <div className="text-xs text-slate-700">
                  {delivery.address_line2}
                </div>
              )}
              <div className="text-xs text-slate-600">
                {delivery.city}, {delivery.state} {delivery.zip_code}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <a
              href={getGoogleMapsUrl(delivery)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold min-h-[44px]"
            >
              <Navigation className="w-4 h-4" />
              <span>Navigate in Maps</span>
              <ExternalLink className="w-3 h-3 opacity-80" />
            </a>

            {delivery.recipient_phone ? (
              <a
                href={`tel:${delivery.recipient_phone}`}
                className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold min-h-[44px]"
              >
                <Phone className="w-4 h-4" />
                <span>Call Recipient</span>
              </a>
            ) : (
              <div className="inline-flex items-center justify-center py-2.5 px-3 rounded-xl bg-slate-100 text-slate-400 text-xs font-medium min-h-[44px]">
                No Phone Listed
              </div>
            )}
          </div>
        </div>

        {/* Schedule & Instructions */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-slate-500 block">Scheduled Date</span>
            <span className="font-semibold text-slate-900 mt-0.5 block">
              {formatDate(delivery.scheduled_date)}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-slate-500 block">Delivery Window</span>
            <span className="font-semibold text-slate-900 mt-0.5 block">
              {formatTimeWindow(
                delivery.time_window_start,
                delivery.time_window_end
              )}
            </span>
          </div>
        </div>

        {delivery.instructions && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950">
            <span className="font-bold uppercase tracking-wider text-[11px] text-amber-800 block mb-0.5">
              Delivery Instructions
            </span>
            <p className="leading-relaxed">{delivery.instructions}</p>
          </div>
        )}

        {/* Start Delivery Button when ASSIGNED */}
        {delivery.status === "ASSIGNED" && (
          <button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            data-testid="start-delivery-btn"
            className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2 min-h-[48px]"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {startMutation.isPending
                ? "Starting Delivery..."
                : "Start Delivery (Mark In Transit)"}
            </span>
          </button>
        )}
      </div>

      {/* Proof-of-Delivery Upload & Completion Card (shown when ASSIGNED or IN_TRANSIT) */}
      {isActive && (
        <div
          data-testid="pod-upload-section"
          className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 space-y-4"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Proof of Delivery (Required)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Capture or select at least 1 clear photo of the delivered package
              at the destination (up to 5 photos, max 10 MB each).
            </p>
          </div>

          {podError && (
            <div
              role="alert"
              data-testid="pod-error-alert"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium"
            >
              {podError}
            </div>
          )}

          <form onSubmit={handleCompleteSubmit} className="space-y-4">
            {/* Camera Capture + Photo Picker Buttons */}
            <div className="grid grid-cols-2 gap-2.5">
              <label
                htmlFor="pod-camera-input"
                className="cursor-pointer flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/50 hover:bg-blue-50 text-blue-700 font-semibold text-xs min-h-[84px] text-center"
              >
                <Camera className="w-6 h-6 text-blue-600" />
                <span>Take Photo</span>
                <input
                  id="pod-camera-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/*"
                  capture="environment"
                  multiple
                  onChange={handlePhotoSelect}
                  className="sr-only"
                />
              </label>

              <label
                htmlFor="pod-file-input"
                data-testid="pod-file-label"
                className="cursor-pointer flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs min-h-[84px] text-center"
              >
                <ImagePlus className="w-6 h-6 text-slate-600" />
                <span>Choose from Device</span>
                <input
                  id="pod-file-input"
                  data-testid="pod-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/*"
                  multiple
                  onChange={handlePhotoSelect}
                  className="sr-only"
                />
              </label>
            </div>

            {/* Selected Photo Previews with Remove / Retake */}
            {selectedPhotos.length > 0 && (
              <div
                data-testid="selected-photo-previews"
                className="grid grid-cols-2 gap-3"
              >
                {selectedPhotos.map((p, idx) => (
                  <div
                    key={p.id}
                    className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 aspect-4/3"
                  >
                    <img
                      src={p.previewUrl}
                      alt={`Selected proof ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 flex items-center justify-between text-white text-[11px]">
                      <span className="truncate max-w-[110px]">
                        {formatBytes(p.file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        data-testid={`remove-photo-${idx}`}
                        aria-label={`Remove photo ${idx + 1}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-600 text-white font-semibold"
                      >
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Optional Recipient Name & Driver Notes */}
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="pod-recipient-confirmed"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Received By (Optional)
                </label>
                <input
                  id="pod-recipient-confirmed"
                  data-testid="pod-recipient-input"
                  type="text"
                  value={recipientConfirmed}
                  onChange={(e) => setRecipientConfirmed(e.target.value)}
                  placeholder="e.g. Front desk clerk, Porch drop-off, J. Doe"
                  className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-blue-600 outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="pod-driver-notes"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Driver Delivery Notes (Optional)
                </label>
                <textarea
                  id="pod-driver-notes"
                  data-testid="pod-notes-input"
                  rows={2}
                  value={driverNotes}
                  onChange={(e) => setDriverNotes(e.target.value)}
                  placeholder="Placement details or access notes..."
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:border-blue-600 outline-none"
                />
              </div>
            </div>

            {/* Consent-Based GPS Location Capture */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={locationConsent}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setLocationConsent(checked);
                    if (checked && !coords) {
                      captureGpsLocation();
                    }
                  }}
                  className="mt-0.5 rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs text-slate-700 leading-snug">
                  <strong>Share GPS coordinates with this proof</strong>{" "}
                  (Optional — captured only with your explicit consent at
                  submission time).
                </span>
              </label>

              {locationConsent && (
                <div className="flex items-center justify-between pl-6 pt-1 text-xs">
                  {coords ? (
                    <span className="text-emerald-700 font-mono font-medium">
                      GPS: {coords.lat}, {coords.lng} (±{coords.acc}m)
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      {locating
                        ? "Acquiring GPS signal..."
                        : "GPS coordinates not yet captured"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={captureGpsLocation}
                    disabled={locating}
                    className="inline-flex items-center gap-1 text-blue-600 font-semibold"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    Refresh GPS
                  </button>
                </div>
              )}
            </div>

            {/* Upload Progress Bar */}
            {uploadProgress !== null && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-blue-700">
                  <span>Uploading & verifying proof...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-blue-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Submit POD Button */}
            <button
              type="submit"
              disabled={submittingPod}
              data-testid="complete-delivery-submit-btn"
              className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 min-h-[48px]"
            >
              <UploadCloud className="w-5 h-5" />
              <span>
                {submittingPod
                  ? "Uploading Proof & Completing..."
                  : `Submit Proof & Mark Delivered (${selectedPhotos.length} photo${
                      selectedPhotos.length === 1 ? "" : "s"
                    })`}
              </span>
            </button>
          </form>

          {/* Report Failed Attempt Trigger */}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowFailModal(true)}
              data-testid="open-fail-modal-btn"
              className="w-full py-2.5 px-4 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-800 font-semibold text-xs flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Unable to Deliver? Report Failed Attempt</span>
            </button>
          </div>
        </div>
      )}

      {/* Uploaded Proof Photographs Section */}
      {proofs.length > 0 && (
        <div
          data-testid="driver-uploaded-proofs"
          className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 space-y-3"
        >
          <h2 className="text-sm font-bold text-slate-900">
            Uploaded Proof Photographs ({proofs.length})
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {proofs.map((proof) => (
              <div
                key={proof.id}
                className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50"
              >
                <button
                  type="button"
                  onClick={() => setLightboxProofId(proof.id)}
                  className="block w-full aspect-4/3 bg-slate-900 overflow-hidden"
                >
                  <img
                    src={api.proofs.thumbnailUrl(proof.id)}
                    alt="Uploaded proof thumbnail"
                    className="w-full h-full object-cover"
                  />
                </button>
                <div className="p-2.5 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">
                      {proof.width}×{proof.height}
                    </span>
                    <ProofReviewBadge status={proof.review_status} />
                  </div>
                  <div className="text-slate-500">
                    {formatDateTime(proof.uploaded_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delivery Event History */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-slate-400" />
          <span>Delivery Activity Timeline</span>
        </h2>
        <div className="space-y-3">
          {events.map((evt) => (
            <div
              key={evt.id}
              className="flex items-start gap-3 text-xs border-l-2 border-slate-200 pl-3 py-0.5"
            >
              <div className="flex-1">
                <div className="font-semibold text-slate-900">
                  {EVENT_TYPE_LABELS[evt.event_type] || evt.event_type}
                </div>
                {evt.reason && (
                  <div className="text-slate-600 mt-0.5">{evt.reason}</div>
                )}
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {formatDateTime(evt.created_at)}
                  {evt.actor
                    ? ` • ${evt.actor.first_name} ${evt.actor.last_name}`
                    : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Report Failed Attempt Modal */}
      <Modal
        open={showFailModal}
        onClose={() => setShowFailModal(false)}
        title="Report Failed Delivery Attempt"
        description="Select a structured reason why this delivery could not be completed."
      >
        <form onSubmit={handleFailSubmit} className="space-y-4">
          {failError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {failError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Failure Reason
            </label>
            <select
              value={failReason}
              onChange={(e) => setFailReason(e.target.value as FailureReason)}
              data-testid="fail-reason-select"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-300 bg-white"
            >
              {(Object.keys(FAILURE_REASON_LABELS) as FailureReason[]).map(
                (r) => (
                  <option key={r} value={r}>
                    {FAILURE_REASON_LABELS[r]}
                  </option>
                )
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Driver Explanation / Notes{" "}
              {failReason === "OTHER" ? "(Required)" : "(Optional)"}
            </label>
            <textarea
              rows={3}
              required={failReason === "OTHER"}
              value={failNotes}
              onChange={(e) => setFailNotes(e.target.value)}
              data-testid="fail-notes-input"
              placeholder="Explain what happened at the stop..."
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Supporting Photo (Optional, e.g. closed gate or notice)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFailPhoto(e.target.files?.[0] || null)}
              className="text-xs text-slate-600"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowFailModal(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingFail}
              data-testid="submit-fail-btn"
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-60"
            >
              {submittingFail ? "Submitting..." : "Confirm Failed Attempt"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Full-Size Proof Preview Modal */}
      <Modal
        open={Boolean(lightboxProofId)}
        onClose={() => setLightboxProofId(null)}
        title="Proof of Delivery Photograph"
        maxWidth="max-w-2xl"
      >
        {lightboxProofId && (
          <div className="space-y-3">
            <div className="rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center max-h-[65vh]">
              <img
                src={api.proofs.previewUrl(lightboxProofId)}
                alt="Full size proof"
                className="max-h-[65vh] w-auto object-contain"
              />
            </div>
            <div className="flex justify-end">
              <a
                href={api.proofs.originalUrl(lightboxProofId, true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold"
              >
                Download Original File
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
