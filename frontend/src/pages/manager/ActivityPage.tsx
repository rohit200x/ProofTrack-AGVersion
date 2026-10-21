import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "../../api/client";
import { StatusBadge } from "../../components/common/StatusBadge";
import { DeliveryDetailDrawer } from "../../components/manager/DeliveryDetailDrawer";
import { EVENT_TYPE_LABELS, formatDateTime } from "../../lib/utils";
import type { DeliveryStatus, EventType } from "../../types";

const PAGE_SIZE = 25;

export const ActivityPage: React.FC = () => {
  const [eventType, setEventType] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    null
  );

  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["activity-log", eventType, page],
    queryFn: () =>
      api.dashboard.activity({
        limit: PAGE_SIZE,
        offset,
        event_type: eventType || undefined,
      }),
    refetchInterval: 25000,
  });

  const events = data?.events || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            <span>Audit Activity Log</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable chronological audit trail of delivery creations, status
            changes, driver assignments, and proof reviews.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by event type"
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            data-testid="activity-type-filter"
            className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 bg-white"
          >
            <option value="">All Event Types</option>
            {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="h-12 bg-slate-100 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            No audit events match the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Delivery Ref</th>
                  <th className="py-3 px-4">Event</th>
                  <th className="py-3 px-4">Transition</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Reason / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {events.map((evt) => (
                  <tr
                    key={evt.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4 whitespace-nowrap text-slate-500">
                      {formatDateTime(evt.created_at)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedDeliveryId(evt.delivery_id)}
                        className="font-mono font-bold text-blue-600 hover:underline"
                      >
                        {evt.delivery_reference || evt.delivery_id.slice(0, 8)}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {EVENT_TYPE_LABELS[evt.event_type as EventType] ||
                        evt.event_type}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {evt.from_status || evt.to_status ? (
                        <div className="inline-flex items-center gap-1.5">
                          {evt.from_status && (
                            <StatusBadge
                              status={evt.from_status as DeliveryStatus}
                              size="sm"
                            />
                          )}
                          {evt.from_status && evt.to_status && (
                            <span className="text-slate-400">→</span>
                          )}
                          {evt.to_status && (
                            <StatusBadge
                              status={evt.to_status as DeliveryStatus}
                              size="sm"
                            />
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                      {evt.actor
                        ? `${evt.actor.first_name} ${evt.actor.last_name}`
                        : "System"}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-md truncate">
                      {evt.reason ||
                        (evt.details && Object.keys(evt.details).length > 0
                          ? JSON.stringify(evt.details)
                          : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>
            Showing{" "}
            <strong>
              {total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE_SIZE, total)}
            </strong>{" "}
            of <strong>{total}</strong> events
          </span>
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 font-semibold"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>
            <span className="px-2 font-semibold">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 font-semibold"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <DeliveryDetailDrawer
        deliveryId={selectedDeliveryId}
        onClose={() => setSelectedDeliveryId(null)}
      />
    </div>
  );
};
