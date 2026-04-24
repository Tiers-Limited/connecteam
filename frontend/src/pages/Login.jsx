import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
  FiMail,
  FiLock,
  FiLogIn,
  FiUsers,
  FiShield,
  FiEye,
  FiEyeOff,
  FiKey,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import { requestResetPin, resetPasswordWithPin } from "../services/authService";

const VIEW = { LOGIN: "login", FORGOT: "forgot", RESET: "reset" };

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState(VIEW.LOGIN);
  const [forgotEmail, setForgotEmail] = useState("");
  const [pin, setPin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Please enter email and password");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      toast.success("Welcome back!");
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestPin(e) {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      toast.error("Please enter your email");
      return;
    }
    setLoading(true);
    try {
      const data = await requestResetPin(forgotEmail.trim());
      toast.success(data.message || "Check your email for the PIN.");
      setPin("");
      setView(VIEW.RESET);
      setEmail(forgotEmail.trim());
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send PIN");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (!pin || pin.length !== 6) {
      toast.error("Enter the 6-digit PIN");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await resetPasswordWithPin(forgotEmail.trim(), pin, newPassword);
      toast.success("Password reset. Sign in with your new password.");
      setView(VIEW.LOGIN);
      setPin("");
      setNewPassword("");
      setConfirmPassword("");
      setForgotEmail("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  // Shared input wrapper style
  const inputWrap =
    "relative flex items-center rounded-xl border border-slate-300 bg-white shadow-sm transition-colors focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 dark:border-white/15 dark:bg-white/5 dark:focus-within:ring-indigo-300/30";
  const inputBase =
    "w-full rounded-xl border-0 bg-transparent py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500";
  const labelBase = "block text-sm font-medium text-slate-600 dark:text-slate-300";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-6 lg:gap-8 items-stretch">
        {/* Left Panel — Branding */}
        <div className="hidden lg:flex flex-col rounded-2xl border border-slate-200 bg-white/90 backdrop-blur-sm p-8 shadow-xl dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-500/20">
              <FiUsers className="h-6 w-6 text-indigo-700 dark:text-indigo-300" />
            </div>
            <span className="text-2xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-700 via-violet-700 to-fuchsia-700 dark:from-indigo-200 dark:via-violet-200 dark:to-fuchsia-300">
              Corvia Tips
            </span>
          </div>

          <div className="flex-1 flex flex-col justify-center space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 leading-tight sm:text-3xl dark:text-white">
              Manage your team and operations in one place
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Sign in with your account to access the dashboard, reports,
              and team tools.
            </p>
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10">
                <FiShield className="h-3 w-3 text-slate-600 dark:text-slate-300" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Secure access with role-based permissions
              </p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-white/10">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              © Corvia Tips. Authorized access only.
            </p>
          </div>
        </div>

        {/* Right Panel — Form */}
        <div className="flex flex-col justify-center rounded-2xl border border-slate-200 bg-white/90 backdrop-blur-sm shadow-xl p-8 lg:p-10 dark:border-white/10 dark:bg-white/5">
          {/* Mobile Logo */}
          <div className="flex items-center gap-2 lg:hidden mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-500/20">
              <FiUsers className="h-5 w-5 text-indigo-700 dark:text-indigo-200" />
            </div>
            <span className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Corvia Tips
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl dark:text-white">
              {view === VIEW.LOGIN && "Welcome back"}
              {view === VIEW.FORGOT && "Forgot password"}
              {view === VIEW.RESET && "Reset password"}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {view === VIEW.LOGIN && "Sign in to your account to continue"}
              {view === VIEW.FORGOT &&
                "Enter your email to receive a 6-digit PIN"}
              {view === VIEW.RESET &&
                "Enter the PIN from your email and your new password"}
            </p>
          </div>

          {/* Forgot: request PIN */}
          {view === VIEW.FORGOT && (
            <form onSubmit={handleRequestPin} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="forgot-email" className={labelBase}>
                  Email address
                </label>
                <div className={inputWrap}>
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiMail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    disabled={loading}
                    className={inputBase}
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white hover:opacity-95"
              >
                {loading ? "Sending…" : "Send PIN"}
              </Button>
              <button
                type="button"
                onClick={() => setView(VIEW.LOGIN)}
                className="w-full text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors dark:text-indigo-300 dark:hover:text-indigo-200"
              >
                Back to sign in
              </button>
            </form>
          )}

          {/* Reset: PIN + new password */}
          {view === VIEW.RESET && (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div className="space-y-2">
                <label className={labelBase}>Email</label>
                <div className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 dark:border-white/15 dark:bg-white/5">
                  <span className="text-sm text-slate-700 dark:text-slate-200">{forgotEmail}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="reset-pin" className={labelBase}>
                  6-digit PIN (sent to your email)
                </label>
                <div className={inputWrap}>
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiKey className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="reset-pin"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    disabled={loading}
                    className={`${inputBase} tracking-[0.4em] font-mono text-lg`}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="new-password" className={labelBase}>
                  New password
                </label>
                <div className={inputWrap}>
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiLock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    disabled={loading}
                    className={`${inputBase} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-0 flex h-full items-center px-3 text-slate-500 hover:text-slate-700 transition-colors dark:text-slate-400 dark:hover:text-slate-200"
                    aria-label={
                      showNewPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showNewPassword ? (
                      <FiEyeOff className="h-5 w-5" />
                    ) : (
                      <FiEye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className={labelBase}>
                  Confirm new password
                </label>
                <div className={inputWrap}>
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiLock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    disabled={loading}
                    className={inputBase}
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white hover:opacity-95"
              >
                {loading ? "Resetting…" : "Reset password"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setView(VIEW.LOGIN);
                  setPin("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className="w-full text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors dark:text-indigo-300 dark:hover:text-indigo-200"
              >
                Back to sign in
              </button>
            </form>
          )}

          {/* Login form */}
          {view === VIEW.LOGIN && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="email" className={labelBase}>
                  Email address
                </label>
                <div className={inputWrap}>
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiMail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    disabled={loading}
                    className={inputBase}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className={labelBase}>
                  Password
                </label>
                <div className={inputWrap}>
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiLock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={loading}
                    className={`${inputBase} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 flex h-full items-center px-3 text-slate-500 hover:text-slate-700 transition-colors dark:text-slate-400 dark:hover:text-slate-200"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <FiEyeOff className="h-5 w-5" />
                    ) : (
                      <FiEye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setView(VIEW.FORGOT);
                    setForgotEmail(email);
                  }}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors dark:text-indigo-300 dark:hover:text-indigo-200"
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white hover:opacity-95"
              >
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
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
                    Signing in…
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-2">
                    <FiLogIn className="h-5 w-5" />
                    Sign in
                  </span>
                )}
              </Button>
            </form>
          )}

          <p className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Authorized personnel only. Contact your administrator for access.
          </p>
        </div>
      </div>
    </div>
  );
}
