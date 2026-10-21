import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ClipboardList,
  CloudOff,
  History,
  KeyRound,
  LogOut,
  RefreshCw,
  Truck,
  Wifi,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../app/AuthContext";
import {
  listPendingSubmissions,
  subscribeOfflineQueue,
  syncPendingSubmissions,
  type PendingSubmission,
} from "../../lib/offlineQueue";
import { Modal } from "../common/StatusBadge";
import { ChangePasswordForm } from "../../pages/auth/LoginPage";

export const DriverLayout: React.FC = () => {
  const { user, logout, toast } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingQueue, setPendingQueue] = useState<PendingSubmission[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const refreshQueue = async () => {
    const items = await listPendingSubmissions();
    setPendingQueue(items);
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { synced, failed } = await syncPendingSubmissions();
      await refreshQueue();
      if (synced > 0) {
        toast({
          type: "success",
          title: `Synced ${synced} pending submission${synced > 1 ? "s" : ""}`,
        });
        queryClient.invalidateQueries({ queryKey: ["driver-deliveries"] });
        queryClient.invalidateQueries({ queryKey: ["driver-history"] });
      }
      if (failed > 0) {
        toast({
          type: "error",
          title: `${failed} submission${failed > 1 ? "s" : ""} could not be synced yet`,
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    refreshQueue();
    const unsub = subscribeOfflineQueue(() => {
      refreshQueue();
    });
    const onOnline = () => {
      setIsOnline(true);
      handleSync();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      unsub();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 pb-20">
      {/* Mobile Top Header */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white shadow-md">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold leading-none">ProofTrack</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {user?.first_name} {user?.last_name}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Network status pill */}
            <div
              data-testid="network-status-pill"
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                isOnline
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3 h-3" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <CloudOff className="w-3 h-3" />
                  <span>Offline</span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              aria-label="Change password"
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 min-w-[40px] min-h-[40px] flex items-center justify-center"
            >
              <KeyRound className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              data-testid="driver-logout-btn"
              aria-label="Sign out"
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 min-w-[40px] min-h-[40px] flex items-center justify-center"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Offline / Pending Uploads Banner */}
        {pendingQueue.length > 0 && (
          <div
            data-testid="offline-queue-banner"
            className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-medium"
          >
            <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
              <span>
                {pendingQueue.length} delivery proof upload
                {pendingQueue.length > 1 ? "s" : ""} queued for sync
              </span>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing || !isOnline}
                data-testid="sync-now-btn"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Mobile Viewport Container */}
      <main className="flex-1 w-full max-w-lg mx-auto px-3.5 py-4">
        <Outlet />
      </main>

      {/* Bottom Mobile Navigation Bar (44x44px touch targets) */}
      <nav
        aria-label="Driver navigation"
        className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 shadow-lg"
      >
        <div className="max-w-lg mx-auto grid grid-cols-2 h-16">
          <NavLink
            to="/driver"
            end
            data-testid="nav-driver-deliveries"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors min-h-[44px] ${
                isActive
                  ? "text-blue-600 bg-blue-50/50"
                  : "text-slate-600 hover:text-slate-900"
              }`
            }
          >
            <ClipboardList className="w-5 h-5" />
            <span>My Deliveries</span>
          </NavLink>

          <NavLink
            to="/driver/history"
            data-testid="nav-driver-history"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors min-h-[44px] ${
                isActive
                  ? "text-blue-600 bg-blue-50/50"
                  : "text-slate-600 hover:text-slate-900"
              }`
            }
          >
            <History className="w-5 h-5" />
            <span>Completed & History</span>
          </NavLink>
        </div>
      </nav>

      <Modal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title="Change Password"
        description="Update your driver account password."
      >
        <ChangePasswordForm onSuccess={() => setShowPasswordModal(false)} />
      </Modal>
    </div>
  );
};
