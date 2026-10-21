import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { LoginPage, ForcedPasswordChangeView } from "../pages/auth/LoginPage";
import { DriverLayout } from "../components/driver/DriverLayout";
import { DriverHomePage } from "../pages/driver/DriverHomePage";
import { DriverDeliveryDetailPage } from "../pages/driver/DriverDeliveryDetailPage";
import { DriverHistoryPage } from "../pages/driver/DriverHistoryPage";
import { ManagerLayout } from "../components/manager/ManagerLayout";
import { DashboardPage } from "../pages/manager/DashboardPage";
import { DeliveriesPage } from "../pages/manager/DeliveriesPage";
import { ActivityPage } from "../pages/manager/ActivityPage";
import { UsersPage } from "../pages/admin/UsersPage";
import { SettingsPage } from "../pages/admin/SettingsPage";
import type { Role } from "../types";

const ProtectedRoute: React.FC<{
  allowedRoles: Role[];
  children: React.ReactElement;
}> = ({ allowedRoles, children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          <span className="text-xs font-medium text-slate-400">
            Verifying session...
          </span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.must_change_password) {
    return <ForcedPasswordChangeView />;
  }

  if (!allowedRoles.includes(user.role)) {
    const fallback =
      user.role === "DRIVER" ? "/driver" : "/manager/dashboard";
    return <Navigate to={fallback} replace />;
  }

  return children;
};

const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.must_change_password) {
    return <ForcedPasswordChangeView />;
  }

  return (
    <Navigate
      to={user.role === "DRIVER" ? "/driver" : "/manager/dashboard"}
      replace
    />
  );
};

export const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Driver Mobile Portal */}
      <Route
        path="/driver"
        element={
          <ProtectedRoute allowedRoles={["DRIVER"]}>
            <DriverLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DriverHomePage />} />
        <Route path="deliveries/:id" element={<DriverDeliveryDetailPage />} />
        <Route path="history" element={<DriverHistoryPage />} />
      </Route>

      {/* Manager & Dispatch Operations Portal */}
      <Route
        path="/manager"
        element={
          <ProtectedRoute allowedRoles={["MANAGER", "ADMIN"]}>
            <ManagerLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/manager/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="deliveries" element={<DeliveriesPage />} />
        <Route path="activity" element={<ActivityPage />} />
      </Route>

      {/* Administrator Portal */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["ADMIN"]}>
            <ManagerLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
};
