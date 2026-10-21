import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FilterX,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { format } from "date-fns";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../app/AuthContext";
import { Modal, StatusBadge } from "../../components/common/StatusBadge";
import { DeliveryDetailDrawer } from "../../components/manager/DeliveryDetailDrawer";
import {
  formatDate,
  formatTimeWindow,
  US_STATES_LIST,
} from "../../lib/utils";
import type { CsvImportResult } from "../../types";

export const DeliveriesPage: React.FC = () => {
  const { toast } = useAuth();
  const queryClient = useQueryClient();

  // Filter & Pagination state
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [driverId, setDriverId] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [hasProofFilter, setHasProofFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState("updated_at");
  const [sortDir, setSortDir] = useState("desc");

  // Modals & Drawer state
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    null
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const queryParams = {
    page,
    page_size: 20,
    search: search.trim() || undefined,
    status: status || undefined,
    driver_id: driverId || undefined,
    unassigned: unassignedOnly || undefined,
    overdue: overdueOnly || undefined,
    has_proof:
      hasProofFilter === "true"
        ? true
        : hasProofFilter === "false"
        ? false
        : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    sort_field: sortField,
    sort_dir: sortDir,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["deliveries", queryParams],
    queryFn: () => api.deliveries.list(queryParams),
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-active"],
    queryFn: () => api.users.drivers(true),
  });

  const clearFilters = () => {
    setPage(1);
    setSearch("");
    setStatus("");
    setDriverId("");
    setUnassignedOnly(false);
    setOverdueOnly(false);
    setHasProofFilter("");
    setDateFrom("");
    setDateTo("");
    setSortField("updated_at");
    setSortDir("desc");
  };

  const items = data?.items || [];

  return (
    <div className="space-y-5">
      {/* Header & Primary Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Deliveries & Dispatch Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Create shipments, assign drivers, import manifests, and inspect
            proof-of-delivery photographs
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={api.deliveries.exportUrl(queryParams)}
            data-testid="export-csv-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </a>

          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            data-testid="open-import-csv-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Bulk Import CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            data-testid="open-create-delivery-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Create Delivery</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 space-y-3 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              data-testid="manager-search-input"
              placeholder="Search by reference (PT-...), order #, recipient, street, city, ZIP..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 focus:border-blue-600 outline-none"
            />
          </div>

          <div>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              data-testid="manager-status-filter"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium"
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="ASSIGNED">Assigned</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="DELIVERED">Delivered</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELED">Canceled</option>
            </select>
          </div>

          <div>
            <select
              aria-label="Filter by assigned driver"
              value={driverId}
              onChange={(e) => {
                setDriverId(e.target.value);
                setPage(1);
              }}
              data-testid="manager-driver-filter"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium"
            >
              <option value="">All Drivers</option>
              {drivers.map((drv) => (
                <option key={drv.id} value={drv.id}>
                  {drv.first_name} {drv.last_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input
                type="checkbox"
                checked={unassignedOnly}
                onChange={(e) => {
                  setUnassignedOnly(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Unassigned Only</span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(e) => {
                  setOverdueOnly(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Overdue Only</span>
            </label>

            <select
              aria-label="Filter by proof existence"
              value={hasProofFilter}
              onChange={(e) => {
                setHasProofFilter(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
            >
              <option value="">Proof: Any</option>
              <option value="true">Has Proof Photo</option>
              <option value="false">Missing Proof Photo</option>
            </select>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Scheduled:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="px-2 py-1 rounded-lg border border-slate-300"
              />
              <span>–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="px-2 py-1 rounded-lg border border-slate-300"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Sort field"
              value={`${sortField}:${sortDir}`}
              onChange={(e) => {
                const [f, d] = e.target.value.split(":");
                setSortField(f);
                setSortDir(d);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
            >
              <option value="updated_at:desc">Sort: Recently Updated</option>
              <option value="scheduled_date:asc">Sort: Scheduled Date ↑</option>
              <option value="scheduled_date:desc">Sort: Scheduled Date ↓</option>
              <option value="reference:asc">Sort: Reference A–Z</option>
              <option value="status:asc">Sort: Status</option>
            </select>

            <button
              type="button"
              onClick={clearFilters}
              data-testid="clear-filters-btn"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-semibold"
            >
              <FilterX className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        </div>
      </div>

      {/* Deliveries Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Recipient & Address</th>
                <th className="py-3 px-4">Scheduled</th>
                <th className="py-3 px-4">Assigned Driver</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Proof</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {isLoading ? (
                [1, 2, 3, 4, 5].map((n) => (
                  <tr key={n} className="animate-pulse">
                    <td colSpan={7} className="py-4 px-4">
                      <div className="h-6 bg-slate-100 rounded" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-slate-500 font-medium"
                  >
                    No deliveries match your current search or filter criteria.
                  </td>
                </tr>
              ) : (
                items.map((d) => (
                  <tr
                    key={d.id}
                    data-testid={`delivery-row-${d.reference}`}
                    onClick={() => setSelectedDeliveryId(d.id)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                  >
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-mono font-bold text-blue-600">
                        {d.reference}
                      </div>
                      {d.external_order_ref && (
                        <div className="text-[11px] text-slate-400">
                          #{d.external_order_ref}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">
                        {d.recipient_name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-xs">
                        {d.address_line1}, {d.city}, {d.state} {d.zip_code}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-medium text-slate-900">
                        {formatDate(d.scheduled_date)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatTimeWindow(
                          d.time_window_start,
                          d.time_window_end
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {d.assigned_driver ? (
                        <span className="font-medium text-slate-800">
                          {d.assigned_driver.first_name}{" "}
                          {d.assigned_driver.last_name}
                        </span>
                      ) : (
                        <span className="text-amber-700 font-semibold">
                          Unassigned
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StatusBadge status={d.status} size="sm" />
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {d.proof_count > 0 ? (
                        <span
                          data-testid={`proof-badge-${d.reference}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]"
                        >
                          <Camera className="w-3 h-3" /> {d.proof_count} photo
                          {d.proof_count > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">None</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        data-testid={`inspect-btn-${d.reference}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDeliveryId(d.id);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 font-semibold text-slate-700"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {data && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
            <div>
              Showing <strong>{items.length}</strong> of{" "}
              <strong>{data.total}</strong> deliveries (Page {data.page} of{" "}
              {Math.max(data.pages, 1)})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Delivery Modal */}
      <CreateDeliveryModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        drivers={drivers}
        onCreated={(createdId) => {
          queryClient.invalidateQueries({ queryKey: ["deliveries"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
          setSelectedDeliveryId(createdId);
          toast({
            type: "success",
            title: "Delivery created",
          });
        }}
      />

      {/* CSV Bulk Import Modal */}
      <CsvImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ["deliveries"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
        }}
      />

      {/* Delivery Detail Inspection Drawer */}
      <DeliveryDetailDrawer
        deliveryId={selectedDeliveryId}
        onClose={() => setSelectedDeliveryId(null)}
      />
    </div>
  );
};

const CreateDeliveryModal: React.FC<{
  open: boolean;
  onClose: () => void;
  drivers: Array<{ id: string; first_name: string; last_name: string; email: string }>;
  onCreated: (id: string) => void;
}> = ({ open, onClose, drivers, onCreated }) => {
  const [reference, setReference] = useState("");
  const [externalOrderRef, setExternalOrderRef] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("Austin");
  const [state, setState] = useState("TX");
  const [zipCode, setZipCode] = useState("78701");
  const [scheduledDate, setScheduledDate] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [instructions, setInstructions] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [assignedDriverId, setAssignedDriverId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await api.deliveries.create({
        reference: reference.trim() || null,
        external_order_ref: externalOrderRef.trim() || null,
        recipient_name: recipientName.trim(),
        recipient_phone: recipientPhone.trim() || null,
        address_line1: address1.trim(),
        address_line2: address2.trim() || null,
        city: city.trim(),
        state,
        zip_code: zipCode.trim(),
        scheduled_date: scheduledDate,
        time_window_start: windowStart || null,
        time_window_end: windowEnd || null,
        instructions: instructions.trim() || null,
        manager_notes: managerNotes.trim() || null,
        assigned_driver_id: assignedDriverId || null,
      });
      setReference("");
      setExternalOrderRef("");
      setRecipientName("");
      setRecipientPhone("");
      setAddress1("");
      setAddress2("");
      setInstructions("");
      setManagerNotes("");
      setAssignedDriverId("");
      onClose();
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create delivery.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create New Delivery"
      description="Enter shipment and destination details. You can assign a driver now or leave it in PENDING status."
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800"
          >
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
              data-testid="create-recipient-name"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="e.g. Jordan Taylor"
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Recipient Phone (US 10-digit)
            </label>
            <input
              type="text"
              data-testid="create-recipient-phone"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="512-555-0192"
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
              data-testid="create-address1"
              value={address1}
              onChange={(e) => setAddress1(e.target.value)}
              placeholder="400 Congress Ave"
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Suite / Apt / Unit
            </label>
            <input
              type="text"
              data-testid="create-address2"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
              placeholder="Suite 1200"
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
              data-testid="create-city"
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
              data-testid="create-state"
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
              data-testid="create-zip"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              placeholder="78701"
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Scheduled Date *
            </label>
            <input
              type="date"
              required
              data-testid="create-scheduled-date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Window Start
            </label>
            <input
              type="time"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Window End
            </label>
            <input
              type="time"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Assign Driver (Optional)
            </label>
            <select
              data-testid="create-driver-select"
              value={assignedDriverId}
              onChange={(e) => setAssignedDriverId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
            >
              <option value="">-- Leave Unassigned (PENDING) --</option>
              {drivers.map((drv) => (
                <option key={drv.id} value={drv.id}>
                  {drv.first_name} {drv.last_name} ({drv.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Custom Reference (Optional)
            </label>
            <input
              type="text"
              data-testid="create-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Auto-generated if blank"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Delivery Instructions / Gate Code
          </label>
          <textarea
            rows={2}
            data-testid="create-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Gate code #4421, leave at reception..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            data-testid="submit-create-delivery-btn"
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? "Creating..." : "Create Delivery"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const CsvImportModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}> = ({ open, onClose, onImported }) => {
  const { toast } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [previewResult, setPreviewResult] = useState<CsvImportResult | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setPreviewResult(null);
    setError(null);
    if (!selected) return;

    setLoading(true);
    try {
      const res = await api.deliveries.importCsv(selected, { dry_run: true });
      setPreviewResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to parse CSV.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.deliveries.importCsv(file, {
        dry_run: false,
        allow_partial: false,
      });
      if (res.created > 0) {
        toast({
          type: "success",
          title: `Imported ${res.created} deliveries`,
        });
        onImported();
        setFile(null);
        setPreviewResult(null);
        onClose();
      } else {
        setPreviewResult(res);
        setError("Fix the row validation errors before importing.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk Import Deliveries via CSV"
      description="Download our CSV template, upload your manifest to preview validation, then commit the batch."
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-900">
              Need the sample CSV template?
            </div>
            <div className="text-slate-500">
              Includes required columns: recipient_name, address_line1, city,
              state, zip_code, scheduled_date
            </div>
          </div>
          <a
            href={api.deliveries.templateUrl()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold shrink-0"
          >
            <Download className="w-3.5 h-3.5" /> Template CSV
          </a>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
            {error}
          </div>
        )}

        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">
            Select UTF-8 CSV File
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="csv-file-input"
            onChange={handleFileChange}
            className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {previewResult && (
          <div
            data-testid="csv-preview-summary"
            className="space-y-3 border-t border-slate-200 pt-3"
          >
            <div className="flex items-center gap-4 font-semibold">
              <span className="text-slate-700">
                Total Rows: {previewResult.total_rows}
              </span>
              <span className="text-emerald-700">
                Valid Rows: {previewResult.valid_rows}
              </span>
              <span className="text-rose-700">
                Invalid Rows: {previewResult.invalid_rows}
              </span>
            </div>

            <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Recipient</th>
                    <th className="py-2 px-3">Address</th>
                    <th className="py-2 px-3">Scheduled</th>
                    <th className="py-2 px-3">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewResult.preview.map((r) => (
                    <tr key={r.row}>
                      <td className="py-2 px-3 font-mono">{r.row}</td>
                      <td className="py-2 px-3 font-medium">
                        {r.recipient_name}
                      </td>
                      <td className="py-2 px-3">
                        {r.address_line1}, {r.city}, {r.state} {r.zip_code}
                      </td>
                      <td className="py-2 px-3">{r.scheduled_date}</td>
                      <td className="py-2 px-3">
                        {r.valid ? (
                          <span className="text-emerald-700 font-semibold">
                            Ready
                          </span>
                        ) : (
                          <span className="text-rose-700 font-semibold">
                            {r.errors.join("; ")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              loading ||
              !previewResult ||
              previewResult.valid_rows === 0 ||
              previewResult.invalid_rows > 0
            }
            onClick={handleConfirmImport}
            data-testid="confirm-csv-import-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold"
          >
            <Upload className="w-4 h-4" />
            {loading
              ? "Importing..."
              : `Import ${previewResult?.valid_rows || 0} Deliveries`}
          </button>
        </div>
      </div>
    </Modal>
  );
};
