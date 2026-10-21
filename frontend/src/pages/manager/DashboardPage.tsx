import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flag,
  Package,
  RefreshCw,
  TrendingUp,
  Truck,
  UserCheck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../api/client";
import { StatusBadge } from "../../components/common/StatusBadge";
import { DeliveryDetailDrawer } from "../../components/manager/DeliveryDetailDrawer";
import {
  EVENT_TYPE_LABELS,
  formatDate,
  formatDateTime,
} from "../../lib/utils";
import type { Delivery } from "../../types";

export const DashboardPage: React.FC = () => {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeQueueTab, setActiveQueueTab] = useState<
    "overdue" | "recent_failures" | "flagged" | "unassigned_today" | "recently_completed"
  >("overdue");
  const [drawerDeliveryId, setDrawerDeliveryId] = useState<string | null>(null);

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
    isFetching: summaryFetching,
  } = useQuery({
    queryKey: ["dashboard-summary", dateFrom, dateTo],
    queryFn: () =>
      api.dashboard.summary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    refetchInterval: 25000,
  });

  const { data: attention, refetch: refetchAttention } = useQuery({
    queryKey: ["dashboard-attention"],
    queryFn: () => api.dashboard.attention(8),
    refetchInterval: 25000,
  });

  const { data: activity, refetch: refetchActivity } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: () => api.dashboard.activity({ limit: 15 }),
    refetchInterval: 25000,
  });

  const handleRefreshAll = () => {
    refetchSummary();
    refetchAttention();
    refetchActivity();
  };

  const chartData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Pending", count: summary.pending, color: "#f59e0b" },
      { name: "Assigned", count: summary.assigned, color: "#6366f1" },
      { name: "In Transit", count: summary.in_transit, color: "#2563eb" },
      { name: "Delivered", count: summary.delivered, color: "#059669" },
      { name: "Failed", count: summary.failed, color: "#e11d48" },
      { name: "Canceled", count: summary.canceled, color: "#64748b" },
    ];
  }, [summary]);

  const queueItems: Delivery[] = useMemo(() => {
    if (!attention) return [];
    return attention[activeQueueTab] || [];
  }, [attention, activeQueueTab]);

  return (
    <div className="space-y-6">
      {/* Top Header & Date Range Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Operations & Dispatch Overview
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Live metrics across your delivery fleet
            {summary?.business_timezone
              ? ` • Business Timezone: ${summary.business_timezone} (${summary.business_today})`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <label htmlFor="dash-from" className="text-slate-500 font-medium">
              From
            </label>
            <input
              id="dash-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="dash-to" className="text-slate-500 font-medium">
              To
            </label>
            <input
              id="dash-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100 font-semibold"
            >
              Reset Dates
            </button>
          )}
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={summaryFetching}
            data-testid="dashboard-refresh-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${summaryFetching ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 8 KPI Cards */}
      {summaryLoading || !summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div
              key={n}
              className="h-24 rounded-2xl bg-white border border-slate-200 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div
          data-testid="dashboard-kpi-grid"
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          <KpiCard
            title="Total Deliveries"
            value={summary.total}
            subtitle={summary.definitions.total}
            icon={<Package className="w-4 h-4 text-slate-600" />}
            accent="border-slate-200"
          />
          <KpiCard
            title="Completion Rate"
            value={`${summary.completion_pct}%`}
            subtitle={summary.definitions.completion_pct}
            icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
            accent="border-emerald-200 bg-emerald-50/30"
          />
          <KpiCard
            title="Delivered (With Proof)"
            value={summary.delivered}
            subtitle={summary.definitions.delivered}
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            accent="border-emerald-200"
          />
          <KpiCard
            title="In Transit"
            value={summary.in_transit}
            subtitle={summary.definitions.in_transit}
            icon={<Truck className="w-4 h-4 text-blue-600" />}
            accent="border-blue-200"
          />
          <KpiCard
            title="Assigned"
            value={summary.assigned}
            subtitle={summary.definitions.assigned}
            icon={<UserCheck className="w-4 h-4 text-indigo-600" />}
            accent="border-indigo-200"
          />
          <KpiCard
            title="Pending Unassigned"
            value={summary.pending}
            subtitle={summary.definitions.pending}
            icon={<Clock className="w-4 h-4 text-amber-600" />}
            accent="border-amber-200"
          />
          <KpiCard
            title="Failed Attempts"
            value={summary.failed}
            subtitle={summary.definitions.failed}
            icon={<AlertTriangle className="w-4 h-4 text-rose-600" />}
            accent="border-rose-200"
          />
          <KpiCard
            title="Overdue Open"
            value={summary.overdue}
            subtitle={summary.definitions.overdue}
            icon={<Flag className="w-4 h-4 text-rose-600" />}
            accent="border-rose-200 bg-rose-50/30"
          />
        </div>
      )}

      {/* Middle Row: Status Distribution Chart + Attention Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Status Distribution Chart */}
        <div className="lg:col-span-5 bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Delivery Status Breakdown
              </h2>
              <p className="text-xs text-slate-500">
                Real-time distribution across status stages
              </p>
            </div>
            <Link
              to="/manager/deliveries"
              className="text-xs font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              Manage All <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Dispatcher Attention Queues */}
        <div className="lg:col-span-7 bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Dispatcher Attention Queues
              </h2>
              <p className="text-xs text-slate-500">
                Click any delivery to inspect proof photos or reassign drivers
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 pb-3 border-b border-slate-100 text-xs">
            {[
              {
                key: "overdue",
                label: `Overdue (${attention?.overdue.length || 0})`,
              },
              {
                key: "recent_failures",
                label: `Failed (${attention?.recent_failures.length || 0})`,
              },
              {
                key: "flagged",
                label: `Flagged Proofs (${attention?.flagged.length || 0})`,
              },
              {
                key: "unassigned_today",
                label: `Unassigned (${attention?.unassigned_today.length || 0})`,
              },
              {
                key: "recently_completed",
                label: `Recently Completed (${
                  attention?.recently_completed.length || 0
                })`,
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveQueueTab(tab.key as any)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                  activeQueueTab === tab.key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex-1 divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {queueItems.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                No deliveries currently in this queue.
              </div>
            ) : (
              queueItems.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDrawerDeliveryId(d.id)}
                  className="w-full py-2.5 px-2 hover:bg-slate-50 flex items-center justify-between gap-3 text-left transition-colors rounded-lg"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-600">
                        {d.reference}
                      </span>
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {d.recipient_name}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {d.city}, {d.state} • Scheduled{" "}
                      {formatDate(d.scheduled_date)}
                      {d.assigned_driver
                        ? ` • Driver: ${d.assigned_driver.first_name} ${d.assigned_driver.last_name}`
                        : " • Unassigned"}
                    </div>
                  </div>
                  <StatusBadge status={d.status} size="sm" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Operational Activity Feed */}
      <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Recent Operational Activity
            </h2>
            <p className="text-xs text-slate-500">
              Latest status transitions, assignments, and proof submissions
            </p>
          </div>
          <Link
            to="/manager/activity"
            className="text-xs font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            Full Audit Log <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="divide-y divide-slate-100">
          {(activity?.events || []).slice(0, 10).map((evt) => (
            <div
              key={evt.id}
              className="py-2.5 flex items-center justify-between gap-4 text-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setDrawerDeliveryId(evt.delivery_id)}
                  className="font-mono font-bold text-blue-600 hover:underline shrink-0"
                >
                  {evt.delivery_reference || "Delivery"}
                </button>
                <span className="font-semibold text-slate-900">
                  {EVENT_TYPE_LABELS[evt.event_type] || evt.event_type}
                </span>
                {evt.actor && (
                  <span className="text-slate-500 truncate">
                    by {evt.actor.first_name} {evt.actor.last_name}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400 shrink-0">
                {formatDateTime(evt.created_at)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <DeliveryDetailDrawer
        deliveryId={drawerDeliveryId}
        onClose={() => setDrawerDeliveryId(null)}
      />
    </div>
  );
};

const KpiCard: React.FC<{
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  accent?: string;
}> = ({ title, value, subtitle, icon, accent = "border-slate-200" }) => (
  <div
    className={`rounded-2xl bg-white p-4 shadow-xs border ${accent} flex flex-col justify-between`}
  >
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold text-slate-600">{title}</span>
      {icon}
    </div>
    <div className="text-2xl font-bold text-slate-900 mt-2">{value}</div>
    {subtitle && (
      <p className="text-[11px] text-slate-400 mt-1 line-clamp-1" title={subtitle}>
        {subtitle}
      </p>
    )}
  </div>
);
