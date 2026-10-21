import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Activity,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { Modal } from "../common/StatusBadge";
import { ChangePasswordForm } from "../../pages/auth/LoginPage";

export const ManagerLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const navItems = [
    {
      to: "/manager/dashboard",
      label: "Dashboard Overview",
      icon: LayoutDashboard,
      testId: "nav-dashboard",
    },
    {
      to: "/manager/deliveries",
      label: "Deliveries & Dispatch",
      icon: Package,
      testId: "nav-deliveries",
    },
    {
      to: "/manager/activity",
      label: "Audit Activity Log",
      icon: Activity,
      testId: "nav-activity",
    },
  ];

  if (user?.role === "ADMIN") {
    navItems.push(
      {
        to: "/admin/users",
        label: "Users & Drivers",
        icon: Users,
        testId: "nav-admin-users",
      },
      {
        to: "/admin/settings",
        label: "System Settings",
        icon: Settings,
        testId: "nav-admin-settings",
      }
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-100 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-950 text-slate-200 border-r border-slate-800 z-30">
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800/80">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-base font-bold text-white tracking-tight block leading-none">
              ProofTrack
            </span>
            <span className="text-[11px] text-slate-400">
              Operations Control
            </span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                data-testid={item.testId}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-300 hover:bg-slate-900 hover:text-white"
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 bg-slate-900/50 space-y-3">
          <div className="flex items-center justify-between">
            <div className="truncate">
              <div className="text-xs font-semibold text-white truncate">
                {user?.first_name} {user?.last_name}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {user?.email}
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {user?.role}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Password</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              data-testid="manager-logout-btn"
              className="inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800/50 text-xs font-medium"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0">
        {/* Mobile/Tablet Topbar */}
        <header className="lg:hidden sticky top-0 z-20 h-14 bg-slate-950 text-white px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="p-2 rounded-lg text-slate-300 hover:text-white"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
            <span className="text-sm font-bold">ProofTrack Dispatch</span>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-xs font-medium text-slate-200"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </header>

        {mobileMenuOpen && (
          <div className="lg:hidden bg-slate-900 text-white px-4 py-3 space-y-1 border-b border-slate-800">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                      isActive ? "bg-blue-600 text-white" : "text-slate-300"
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      <Modal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title="Change Password"
        description="Update your account password."
      >
        <ChangePasswordForm onSuccess={() => setShowPasswordModal(false)} />
      </Modal>
    </div>
  );
};
