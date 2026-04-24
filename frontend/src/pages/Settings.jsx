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
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-50 p-4 shadow-2xl sm:p-6 dark:border-white/10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="pointer-events-none absolute -top-20 -right-10 h-56 w-56 rounded-full bg-indigo-500/15 blur-3xl dark:bg-indigo-500/20" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl" />
      <div className="relative space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-lg backdrop-blur dark:border-white/10 dark:bg-white/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 dark:text-indigo-300">
            Corvia Security
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Settings
          </h1>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-xl backdrop-blur dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5 dark:border-white/10">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-500/20">
                <FiUser className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Account</h2>
            </div>
            <dl className="divide-y divide-slate-200 px-6 dark:divide-white/10">
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-sm text-slate-600 dark:text-slate-300">Email</dt>
                <dd className="truncate text-right text-sm font-medium text-slate-900 dark:text-slate-100">
                  {user?.email}
                </dd>
              </div>
              {user?.username && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-sm text-slate-600 dark:text-slate-300">Username</dt>
                  <dd className="truncate text-right text-sm font-medium text-slate-900 dark:text-slate-100">
                    {user.username}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-sm text-slate-600 dark:text-slate-300">Role</dt>
                <dd className="text-right text-sm font-medium capitalize text-slate-900 dark:text-slate-100">
                  {user?.role}
                </dd>
              </div>
            </dl>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-xl backdrop-blur dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5 dark:border-white/10">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10">
                <FiShield className="h-5 w-5 text-slate-700 dark:text-slate-300" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Change password
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
            {/* Current password */}
            <div>
              <label
                htmlFor="current-password"
                className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                Current password
              </label>
              <div className="relative flex items-center rounded-lg border border-slate-200 bg-white shadow-sm transition-colors focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 dark:border-white/15 dark:bg-white/5 dark:focus-within:ring-indigo-300/30">
                <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-5 w-5 text-slate-400 dark:text-slate-400" />
                </div>
                <input
                  id="current-password"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full rounded-lg border-0 bg-transparent py-2.5 pl-10 pr-11 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-0 flex h-full items-center px-3 text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
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
                className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                New password
              </label>
              <div className="relative flex items-center rounded-lg border border-slate-200 bg-white shadow-sm transition-colors focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 dark:border-white/15 dark:bg-white/5 dark:focus-within:ring-indigo-300/30">
                <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-5 w-5 text-slate-400 dark:text-slate-400" />
                </div>
                <input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full rounded-lg border-0 bg-transparent py-2.5 pl-10 pr-11 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-0 flex h-full items-center px-3 text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
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
                className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                Confirm new password
              </label>
              <div className="relative flex items-center rounded-lg border border-slate-200 bg-white shadow-sm transition-colors focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 dark:border-white/15 dark:bg-white/5 dark:focus-within:ring-indigo-300/30">
                <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                  <FiLock className="h-5 w-5 text-slate-400 dark:text-slate-400" />
                </div>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full rounded-lg border-0 bg-transparent py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="pt-1">
              <Button
                type="submit"
                disabled={loading}
                className="w-full sm:w-auto min-w-[160px] inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white hover:opacity-95"
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
    </div>
  );
}
