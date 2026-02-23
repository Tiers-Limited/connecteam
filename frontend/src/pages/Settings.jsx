import { useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import { changePassword } from "../services/authService";
import Button from "../components/ui/Button";
import { FiLock, FiEye, FiEyeOff, FiUser, FiShield } from "react-icons/fi";

export default function Settings() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!currentPassword) {
      toast.error("Enter your current password");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your account and security preferences.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        {/* Account summary */}
        <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50">
              <FiUser className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-700">
                Account
              </h2>
              <p className="text-xs text-slate-400">Your profile details</p>
            </div>
          </div>
          <dl className="divide-y divide-slate-100 px-6">
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-slate-500">Email</dt>
              <dd className="truncate text-right text-sm font-medium text-slate-700">
                {user?.email}
              </dd>
            </div>
            {user?.username && (
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-sm text-slate-500">Username</dt>
                <dd className="truncate text-right text-sm font-medium text-slate-700">
                  {user.username}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-slate-500">Role</dt>
              <dd className="text-right text-sm font-medium capitalize text-slate-700">
                {user?.role}
              </dd>
            </div>
          </dl>
        </div>

        {/* Change password */}
        <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
              <FiShield className="h-5 w-5 text-slate-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-700">
                Change password
              </h2>
              <p className="text-xs text-slate-400">
                Update your password to keep your account secure.
              </p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
            {/* Current password */}
            <div>
              <label
                htmlFor="current-password"
                className="mb-1.5 block text-sm font-medium text-slate-600"
              >
                Current password
              </label>
              <div className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="current-password"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full rounded-lg border-0 bg-transparent py-2.5 pl-10 pr-11 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-0 flex h-full items-center px-3 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showCurrent ? "Hide password" : "Show password"}
                >
                  {showCurrent ? (
                    <FiEyeOff className="h-5 w-5" />
                  ) : (
                    <FiEye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label
                htmlFor="new-password"
                className="mb-1.5 block text-sm font-medium text-slate-600"
              >
                New password
              </label>
              <div className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full rounded-lg border-0 bg-transparent py-2.5 pl-10 pr-11 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-0 flex h-full items-center px-3 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showNew ? "Hide password" : "Show password"}
                >
                  {showNew ? (
                    <FiEyeOff className="h-5 w-5" />
                  ) : (
                    <FiEye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-sm font-medium text-slate-600"
              >
                Confirm new password
              </label>
              <div className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full rounded-lg border-0 bg-transparent py-2.5 pl-10 pr-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                />
              </div>
            </div>

            <div className="pt-1">
              <Button
                type="submit"
                disabled={loading}
                className="w-full sm:w-auto min-w-[160px] inline-flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Updating…
                  </>
                ) : (
                  "Change password"
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
