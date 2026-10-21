import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Database,
  Globe,
  HardDrive,
  RefreshCw,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../app/AuthContext";

export const SettingsPage: React.FC = () => {
  const { toast } = useAuth();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["system-settings"],
    queryFn: () => api.settings.get(),
  });

  const [orgName, setOrgName] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [retentionDays, setRetentionDays] = useState(365);
  const [saving, setSaving] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<Record<
    string,
    number
  > | null>(null);

  useEffect(() => {
    if (settings) {
      setOrgName(settings.organization_name);
      setTimezone(settings.business_timezone);
      setRetentionDays(settings.proof_retention_days);
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.settings.update({
        organization_name: orgName.trim(),
        business_timezone: timezone,
        proof_retention_days: Number(retentionDays),
      });
      toast({
        type: "success",
        title: "Settings updated",
        description: "Organization configuration saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    } catch (err) {
      toast({
        type: "error",
        title: err instanceof ApiError ? err.message : "Failed to save settings",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const res = await api.settings.reconcileStorage();
      setReconcileResult(res);
      toast({
        type: "success",
        title: "Storage reconciliation finished",
      });
    } catch (err) {
      toast({
        type: "error",
        title:
          err instanceof ApiError
            ? err.message
            : "Storage reconciliation failed",
      });
    } finally {
      setReconciling(false);
    }
  };

  if (isLoading || !settings) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-64 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" />
          <span>System & Organization Settings</span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure operational timezone, proof-of-delivery retention policies,
          and object storage maintenance.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-5 text-xs"
      >
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Globe className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-bold text-slate-900">
            Operational Preferences
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="org-name-input"
              className="block font-semibold text-slate-700 mb-1"
            >
              Organization Name
            </label>
            <input
              id="org-name-input"
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
            />
          </div>

          <div>
            <label
              htmlFor="tz-select"
              className="block font-semibold text-slate-700 mb-1"
            >
              Business Timezone (Overdue & Daily KPI Cutoff)
            </label>
            <select
              id="tz-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs"
            >
              {settings.supported_timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="retention-input"
              className="block font-semibold text-slate-700 mb-1"
            >
              Proof Evidence Retention Period (Days)
            </label>
            <input
              id="retention-input"
              type="number"
              min={30}
              max={3650}
              required
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Valid range: 30 to 3,650 days (10 years).
            </p>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            data-testid="save-settings-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </form>

      {/* Enforced Security & Upload Policies */}
      <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4 text-xs">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <h2 className="text-sm font-bold text-slate-900">
            Enforced Security & Proof Policies
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-slate-500 font-medium">
              Max Photo Upload Size
            </div>
            <div className="text-base font-bold text-slate-900 mt-1">
              {settings.max_upload_mb} MB per file
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-slate-500 font-medium">
              Max Proof Photos per Delivery
            </div>
            <div className="text-base font-bold text-slate-900 mt-1">
              {settings.max_proof_photos} photos
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-slate-500 font-medium">
              Storage Access Mode
            </div>
            <div className="text-base font-bold text-emerald-700 mt-1">
              Private S3 (Auth Proxied)
            </div>
          </div>
        </div>
      </div>

      {/* Object Storage Maintenance */}
      <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4 text-xs">
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-indigo-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Storage Orphan Reconciliation
              </h2>
              <p className="text-[11px] text-slate-500">
                Cleans up any uncommitted S3 object keys left behind by
                interrupted multipart transactions.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleReconcile}
            disabled={reconciling}
            data-testid="reconcile-storage-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${reconciling ? "animate-spin" : ""}`}
            />
            {reconciling ? "Reconciling..." : "Run Reconciliation"}
          </button>
        </div>

        {reconcileResult && (
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-4">
            <Database className="w-4 h-4 text-slate-600" />
            <div>
              <span className="font-semibold text-slate-800">
                Reconciliation Report:
              </span>{" "}
              {JSON.stringify(reconcileResult)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
