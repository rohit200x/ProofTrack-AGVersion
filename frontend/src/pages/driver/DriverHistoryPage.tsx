import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Camera, CheckCircle2, ChevronRight, History } from "lucide-react";
import { api } from "../../api/client";
import { StatusBadge } from "../../components/common/StatusBadge";
import { formatDateTime, formatFullAddress } from "../../lib/utils";

export const DriverHistoryPage: React.FC = () => {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["driver-history", page],
    queryFn: () => api.driver.history(page, 20),
  });

  const items = data?.items || [];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <History className="w-5 h-5 text-blue-600" />
          <span>Completed & Failed History</span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Past deliveries completed with proof or marked failed on your route.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-24 rounded-2xl bg-white border border-slate-200 animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-slate-200">
          <CheckCircle2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800">
            No completed history yet
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Deliveries you complete or report failed will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <Link
              key={d.id}
              to={`/driver/deliveries/${d.id}`}
              className="block bg-white rounded-2xl p-4 shadow-xs border border-slate-200 hover:border-blue-400 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs font-bold text-slate-500">
                    {d.reference}
                  </span>
                  <h2 className="text-sm font-bold text-slate-900 mt-0.5">
                    {d.recipient_name}
                  </h2>
                </div>
                <StatusBadge status={d.status} size="sm" />
              </div>

              <p className="text-xs text-slate-600 mt-1.5">
                {formatFullAddress(d)}
              </p>

              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {d.delivered_at
                    ? `Delivered ${formatDateTime(d.delivered_at)}`
                    : `Attempted ${formatDateTime(d.attempted_at)}`}
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-blue-600">
                  <Camera className="w-3.5 h-3.5" />
                  {d.proof_count} proof{d.proof_count === 1 ? "" : "s"}
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Link>
          ))}

          {data && data.pages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs text-slate-600">
                Page {data.page} of {data.pages}
              </span>
              <button
                type="button"
                disabled={page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
