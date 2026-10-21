import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  ChevronRight,
  Clock,
  MapPin,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { format } from "date-fns";
import { api } from "../../api/client";
import { useAuth } from "../../app/AuthContext";
import { StatusBadge } from "../../components/common/StatusBadge";
import { formatDate, formatFullAddress, formatTimeWindow } from "../../lib/utils";
import type { DeliveryStatus } from "../../types";

export const DriverHomePage: React.FC = () => {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dateScope, setDateScope] = useState<"ALL" | "TODAY">("ALL");

  const todayIso = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const {
    data: deliveries = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: [
      "driver-deliveries",
      dateScope === "TODAY" ? todayIso : "",
      statusFilter === "ALL" ? "" : statusFilter,
      search.trim(),
    ],
    queryFn: () =>
      api.driver.deliveries({
        date: dateScope === "TODAY" ? todayIso : undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        search: search.trim() || undefined,
        include_overdue: true,
      }),
    refetchInterval: 20000,
  });

  const stats = useMemo(() => {
    const counts = {
      assigned: 0,
      in_transit: 0,
      delivered: 0,
      failed: 0,
    };
    for (const d of deliveries) {
      if (d.status === "ASSIGNED") counts.assigned += 1;
      else if (d.status === "IN_TRANSIT") counts.in_transit += 1;
      else if (d.status === "DELIVERED") counts.delivered += 1;
      else if (d.status === "FAILED") counts.failed += 1;
    }
    return counts;
  }, [deliveries]);

  return (
    <div className="space-y-4">
      {/* Greeting & Date Card */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {format(new Date(), "EEEE, MMMM d, yyyy")}
            </p>
            <h1 className="text-lg font-bold text-slate-900 mt-0.5">
              Hello, {user?.first_name}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh deliveries"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 min-h-[40px]"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>

        {/* Route Summary Counters */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 p-2.5 text-center">
            <div className="text-lg font-bold text-indigo-800">
              {stats.assigned}
            </div>
            <div className="text-[11px] font-medium text-indigo-600">
              Assigned
            </div>
          </div>
          <div className="rounded-xl bg-blue-50/70 border border-blue-100 p-2.5 text-center">
            <div className="text-lg font-bold text-blue-800">
              {stats.in_transit}
            </div>
            <div className="text-[11px] font-medium text-blue-600">
              In Transit
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 p-2.5 text-center">
            <div className="text-lg font-bold text-emerald-800">
              {stats.delivered}
            </div>
            <div className="text-[11px] font-medium text-emerald-600">
              Completed
            </div>
          </div>
          <div className="rounded-xl bg-rose-50/70 border border-rose-100 p-2.5 text-center">
            <div className="text-lg font-bold text-rose-800">{stats.failed}</div>
            <div className="text-[11px] font-medium text-rose-600">Failed</div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl p-3.5 shadow-xs border border-slate-200 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, recipient, street, ZIP..."
            data-testid="driver-search-input"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:border-blue-600 outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setDateScope("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                dateScope === "ALL"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              All Assigned
            </button>
            <button
              type="button"
              onClick={() => setDateScope("TODAY")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                dateScope === "TODAY"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              Today & Overdue
            </button>
          </div>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            data-testid="driver-status-select"
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white min-h-[36px]"
          >
            <option value="ALL">All Statuses</option>
            <option value="ASSIGNED,IN_TRANSIT">Active Stop Queue</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="DELIVERED">Delivered</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
      </div>

      {/* Deliveries List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-32 rounded-2xl bg-white border border-slate-200 animate-pulse p-4"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-center">
          <p className="text-sm font-semibold text-rose-900">
            Could not load assigned deliveries
          </p>
          <p className="text-xs text-rose-700 mt-1">
            Check your network connection and tap Retry.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 px-4 py-2 rounded-xl bg-rose-700 text-white text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      ) : deliveries.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800">
            No matching deliveries found
          </p>
          <p className="text-xs text-slate-500 mt-1">
            You have no deliveries matching the current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="driver-delivery-list">
          {deliveries.map((d) => (
            <Link
              key={d.id}
              to={`/driver/deliveries/${d.id}`}
              data-testid={`driver-delivery-card-${d.reference}`}
              className="block bg-white rounded-2xl p-4 shadow-xs border border-slate-200 hover:border-blue-400 active:scale-[0.99] transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs font-bold text-slate-500">
                    {d.reference}
                  </span>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {d.recipient_name}
                  </h2>
                </div>
                <StatusBadge status={d.status as DeliveryStatus} />
              </div>

              <div className="mt-2.5 flex items-start gap-2 text-xs text-slate-700">
                <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span className="font-medium leading-snug">
                  {formatFullAddress(d)}
                </span>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {formatDate(d.scheduled_date)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {formatTimeWindow(d.time_window_start, d.time_window_end)}
                  </span>
                </div>
                <span className="inline-flex items-center gap-0.5 text-blue-600 font-semibold">
                  Open <ChevronRight className="w-4 h-4" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
