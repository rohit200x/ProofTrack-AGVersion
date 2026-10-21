import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Edit3,
  KeyRound,
  Plus,
  Search,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../app/AuthContext";
import { Modal } from "../../components/common/StatusBadge";
import { formatDateTime } from "../../lib/utils";
import type { Role, User } from "../../types";

export const UsersPage: React.FC = () => {
  const { user: currentUser, toast } = useAuth();
  const queryClient = useQueryClient();

  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", roleFilter, statusFilter, search.trim(), page],
    queryFn: () =>
      api.users.list({
        role: roleFilter || undefined,
        is_active:
          statusFilter === "active"
            ? true
            : statusFilter === "inactive"
            ? false
            : undefined,
        search: search.trim() || undefined,
        page,
        page_size: 25,
      }),
  });

  const users = data?.items || [];

  const handleToggleActive = async (target: User) => {
    try {
      await api.users.update(target.id, { is_active: !target.is_active });
      toast({
        type: "success",
        title: target.is_active
          ? `${target.first_name} deactivated`
          : `${target.first_name} activated`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    } catch (err) {
      toast({
        type: "error",
        title:
          err instanceof ApiError ? err.message : "Could not update user status",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <span>Users & Drivers Management</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Provision field drivers, dispatch managers, and administrators.
            Manage account status and password resets.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          data-testid="create-user-btn"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
        >
          <UserPlus className="w-4 h-4" />
          <span>Create User / Driver</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, or phone..."
            data-testid="users-search-input"
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-600 outline-none"
          />
        </div>

        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          data-testid="users-role-filter"
          className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 bg-white"
        >
          <option value="">All Roles</option>
          <option value="DRIVER">Drivers</option>
          <option value="MANAGER">Managers</option>
          <option value="ADMIN">Administrators</option>
        </select>

        <select
          aria-label="Filter by account status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 bg-white"
        >
          <option value="">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="inactive">Deactivated Only</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-12 bg-slate-100 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            No users found matching your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Phone</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Last Login</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    data-testid={`user-row-${u.email}`}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">
                        {u.first_name} {u.last_name}
                      </div>
                      <div className="text-[11px] text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          u.role === "ADMIN"
                            ? "bg-purple-100 text-purple-800 border border-purple-200"
                            : u.role === "MANAGER"
                            ? "bg-blue-100 text-blue-800 border border-blue-200"
                            : "bg-indigo-100 text-indigo-800 border border-indigo-200"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {u.phone || "—"}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <UserCheck className="w-3.5 h-3.5" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                            <UserX className="w-3.5 h-3.5" /> Deactivated
                          </span>
                        )}
                        {u.must_change_password && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 font-medium">
                            <ShieldAlert className="w-3 h-3" /> Password reset
                            pending
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {formatDateTime(u.last_login_at)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setResettingUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold"
                        >
                          <KeyRound className="w-3.5 h-3.5" /> Reset PW
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            className={`px-2.5 py-1.5 rounded-lg font-semibold ${
                              u.is_active
                                ? "bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
                                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                            }`}
                          >
                            {u.is_active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New User or Driver"
        description="Provision an account with role-based permissions."
      >
        <CreateUserForm
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            queryClient.invalidateQueries({ queryKey: ["drivers"] });
          }}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* Edit User Modal */}
      <Modal
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title="Edit User Account"
        description={editingUser?.email}
      >
        {editingUser && (
          <EditUserForm
            user={editingUser}
            onSuccess={() => {
              setEditingUser(null);
              queryClient.invalidateQueries({ queryKey: ["admin-users"] });
              queryClient.invalidateQueries({ queryKey: ["drivers"] });
            }}
            onCancel={() => setEditingUser(null)}
          />
        )}
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={Boolean(resettingUser)}
        onClose={() => setResettingUser(null)}
        title="Reset Temporary Password"
        description={`Set a temporary password for ${resettingUser?.first_name} ${resettingUser?.last_name}. Active sessions will be revoked and the user will be required to change their password at next sign-in.`}
      >
        {resettingUser && (
          <ResetPasswordForm
            user={resettingUser}
            onSuccess={() => {
              setResettingUser(null);
              queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            }}
            onCancel={() => setResettingUser(null)}
          />
        )}
      </Modal>
    </div>
  );
};

const CreateUserForm: React.FC<{
  onSuccess: () => void;
  onCancel: () => void;
}> = ({ onSuccess, onCancel }) => {
  const { toast } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("DRIVER");
  const [password, setPassword] = useState("DriverPass2026!");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.users.create({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        role,
        password,
      });
      toast({
        type: "success",
        title: "Account created",
        description: `${firstName} ${lastName} (${role}) is now active.`,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            First Name *
          </label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Last Name *
          </label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>
      </div>

      <div>
        <label className="block font-semibold text-slate-700 mb-1">
          Email Address *
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="driver3@prooftrack.test"
          className="w-full px-3 py-2 rounded-lg border border-slate-300"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Role *
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
          >
            <option value="DRIVER">DRIVER (Mobile Field App)</option>
            <option value="MANAGER">MANAGER (Dispatch Dashboard)</option>
            <option value="ADMIN">ADMIN (Full System Access)</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            US Phone (Optional)
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="555-234-5678"
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>
      </div>

      <div>
        <label className="block font-semibold text-slate-700 mb-1">
          Initial Password (min 10 chars, upper, lower, digit) *
        </label>
        <input
          type="text"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
        />
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          data-testid="submit-create-user"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
        >
          <Plus className="w-4 h-4" />
          {saving ? "Creating..." : "Create Account"}
        </button>
      </div>
    </form>
  );
};

const EditUserForm: React.FC<{
  user: User;
  onSuccess: () => void;
  onCancel: () => void;
}> = ({ user, onSuccess, onCancel }) => {
  const { toast } = useAuth();
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone || "");
  const [role, setRole] = useState<Role>(user.role);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.users.update(user.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        role,
      });
      toast({
        type: "success",
        title: "Account updated",
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update user.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            First Name
          </label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Last Name
          </label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>
      </div>

      <div>
        <label className="block font-semibold text-slate-700 mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-300"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
          >
            <option value="DRIVER">DRIVER</option>
            <option value="MANAGER">MANAGER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
        >
          <CheckCircle2 className="w-4 h-4" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
};

const ResetPasswordForm: React.FC<{
  user: User;
  onSuccess: () => void;
  onCancel: () => void;
}> = ({ user, onSuccess, onCancel }) => {
  const { toast } = useAuth();
  const [newPassword, setNewPassword] = useState("TempReset2026!");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.users.resetPassword(user.id, newPassword);
      toast({
        type: "success",
        title: "Temporary password set",
        description: `${user.email} must change their password at next login.`,
      });
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to reset password."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
          {error}
        </div>
      )}
      <div>
        <label className="block font-semibold text-slate-700 mb-1">
          New Temporary Password
        </label>
        <input
          type="text"
          required
          minLength={10}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
        />
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-60"
        >
          <KeyRound className="w-4 h-4" />
          {saving ? "Resetting..." : "Reset Password"}
        </button>
      </div>
    </form>
  );
};
