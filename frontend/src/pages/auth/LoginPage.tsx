import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, KeyRound, Lock, Mail, ShieldCheck, Truck } from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { api, ApiError } from "../../api/client";

export const LoginPage: React.FC = () => {
  const { user, login, toast } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user && !user.must_change_password) {
    return (
      <Navigate
        to={user.role === "DRIVER" ? "/driver" : "/manager/dashboard"}
        replace
      />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedIn = await login(email.trim(), password);
      toast({
        type: "success",
        title: `Welcome back, ${loggedIn.first_name}!`,
      });
      if (!loggedIn.must_change_password) {
        navigate(
          loggedIn.role === "DRIVER" ? "/driver" : "/manager/dashboard",
          { replace: true }
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to reach server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("DemoPass2026!");
    setError(null);
  };

  if (user && user.must_change_password) {
    return <ForcedPasswordChangeView />;
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-950 text-white">
      {/* Left branding panel on desktop */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 border-r border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-white">
              ProofTrack
            </span>
            <span className="block text-xs text-slate-400">
              Enterprise Logistics & Proof of Delivery
            </span>
          </div>
        </div>

        <div className="max-w-md space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-medium">
            <ShieldCheck className="w-4 h-4" />
            Verified Chain-of-Custody Evidence
          </div>
          <h1 className="text-3xl font-bold leading-tight text-white">
            Real-time field dispatch & cryptographic proof of delivery.
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Drivers capture verified delivery photographs directly from mobile
            devices with offline resilience. Dispatchers monitor route progress,
            audit timestamps, and review delivery evidence in one unified
            command center.
          </p>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
              <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                Field Drivers
              </div>
              <div className="text-sm text-slate-200 mt-1">
                Mobile camera POD, GPS consent & offline queue
              </div>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
              <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Dispatch & Ops
              </div>
              <div className="text-sm text-slate-200 mt-1">
                Live KPIs, CSV bulk import & private S3 evidence review
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500">
          © {new Date().getFullYear()} ProofTrack Logistics Systems. Authorized
          personnel only.
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 bg-slate-50 text-slate-900">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200/80 p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-slate-900">ProofTrack</span>
              <span className="block text-xs text-slate-500">
                Logistics & Proof of Delivery
              </span>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="text-sm text-slate-500 mt-1">
            Enter your organization credentials to access your workspace.
          </p>

          {error && (
            <div
              role="alert"
              data-testid="login-error"
              className="mt-4 flex items-start gap-2.5 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              data-testid="login-submit"
              className="w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-semibold text-sm shadow-sm transition-colors min-h-[44px]"
            >
              {submitting ? "Signing in..." : "Sign in to ProofTrack"}
            </button>
          </form>

          {/* Quick-fill demo credentials for local evaluation */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
              Demo Accounts (Development Environment)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="demo-manager-btn"
                onClick={() => fillDemo("manager@prooftrack.test")}
                className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-800">
                  Manager / Dispatch
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  manager@prooftrack.test
                </div>
              </button>
              <button
                type="button"
                data-testid="demo-driver1-btn"
                onClick={() => fillDemo("driver1@prooftrack.test")}
                className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-800">
                  Driver 1 (Mobile)
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  driver1@prooftrack.test
                </div>
              </button>
              <button
                type="button"
                data-testid="demo-driver2-btn"
                onClick={() => fillDemo("driver2@prooftrack.test")}
                className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-800">
                  Driver 2 (Mobile)
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  driver2@prooftrack.test
                </div>
              </button>
              <button
                type="button"
                data-testid="demo-admin-btn"
                onClick={() => fillDemo("admin@prooftrack.test")}
                className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-800">
                  Administrator
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  admin@prooftrack.test
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ForcedPasswordChangeView: React.FC = () => {
  const { user, refreshUser, logout, toast } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      const updated = await refreshUser();
      toast({
        type: "success",
        title: "Password updated",
        description: "Your temporary password has been replaced.",
      });
      if (updated) {
        navigate(
          updated.role === "DRIVER" ? "/driver" : "/manager/dashboard",
          { replace: true }
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
          <KeyRound className="w-5 h-5" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          Password Change Required
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          Signed in as <strong>{user?.email}</strong>. For security, you must set
          a new password before accessing operational records.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Current / Temporary Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              New Password (min 10 chars, upper, lower, digit)
            </label>
            <input
              type="password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              minLength={10}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => logout()}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Sign out
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              {submitting ? "Updating..." : "Save New Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const ChangePasswordForm: React.FC<{ onSuccess: () => void }> = ({
  onSuccess,
}) => {
  const { toast } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      toast({
        type: "success",
        title: "Password changed",
        description: "Your password has been updated.",
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Current Password
        </label>
        <input
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          New Password (10+ characters, mixed case & number)
        </label>
        <input
          type="password"
          required
          minLength={10}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60"
        >
          <CheckCircle2 className="w-4 h-4" />
          {saving ? "Saving..." : "Update Password"}
        </button>
      </div>
    </form>
  );
};
