import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import {
  createSupervisor,
  getSupervisors,
  updateSupervisor,
  deleteSupervisor,
  setSupervisorPassword,
} from "../services/supervisorService";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import {
  FiMail,
  FiUser,
  FiUserPlus,
  FiX,
  FiEdit2,
  FiTrash2,
  FiKey,
} from "react-icons/fi";

export default function CreateSupervisor() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [autoGeneratePassword, setAutoGeneratePassword] = useState(true);
  const [createPassword, setCreatePassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editEmail, setEditEmail] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const isAdmin = user?.role === "admin";

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await getSupervisors();
      setList(data || []);
    } catch {
      setList([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadList();
  }, [isAdmin, loadList]);

  useEffect(() => {
    if (!modalOpen && !editId && !deleteTarget && !passwordTarget) return;
    const onEscape = (e) => {
      if (e.key === "Escape") {
        closeModal();
        closeEditModal();
        closeDeleteModal();
        closePasswordModal();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [modalOpen, editId, deleteTarget, passwordTarget]);

  function openModal() {
    setEmail("");
    setUsername("");
    setAutoGeneratePassword(true);
    setCreatePassword("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEmail("");
    setUsername("");
    setAutoGeneratePassword(true);
    setCreatePassword("");
  }

  function openEditModal(s) {
    setEditId(s._id);
    setEditEmail(s.email);
    setEditUsername(s.username);
  }

  function closeEditModal() {
    setEditId(null);
    setEditEmail("");
    setEditUsername("");
  }

  function openDeleteModal(s) {
    setDeleteTarget({ id: s._id, email: s.email });
  }

  function closeDeleteModal() {
    setDeleteTarget(null);
  }

  function openPasswordModal(s) {
    setPasswordTarget({ id: s._id, email: s.email });
    setNewPassword("");
    setConfirmPassword("");
  }

  function closePasswordModal() {
    setPasswordTarget(null);
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    if (!passwordTarget?.id) return;
    const p = newPassword;
    const c = confirmPassword;
    if (p.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (p !== c) {
      toast.error("Passwords do not match");
      return;
    }
    setPasswordSaving(true);
    try {
      await setSupervisorPassword(passwordTarget.id, p);
      toast.success("Password updated for this supervisor.");
      closePasswordModal();
    } catch (err) {
      toast.error(
        err.response?.data?.message || "Failed to update password",
      );
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();
    if (!trimmedEmail) {
      toast.error("Email is required");
      return;
    }
    if (!trimmedUsername) {
      toast.error("Username is required");
      return;
    }
    if (!autoGeneratePassword) {
      const p = createPassword;
      if (p.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }
      if (p.length > 128) {
        toast.error("Password must be at most 128 characters");
        return;
      }
    }
    setLoading(true);
    try {
      await createSupervisor(
        trimmedEmail,
        trimmedUsername,
        !autoGeneratePassword ? { password: createPassword } : {},
      );
      toast.success(
        "Supervisor created. Credentials have been sent to their email.",
      );
      closeModal();
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create supervisor");
    } finally {
      setLoading(false);
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    const trimmedEmail = editEmail.trim();
    const trimmedUsername = editUsername.trim();
    if (!trimmedEmail) {
      toast.error("Email is required");
      return;
    }
    if (!trimmedUsername) {
      toast.error("Username is required");
      return;
    }
    setLoading(true);
    try {
      await updateSupervisor(editId, trimmedEmail, trimmedUsername);
      toast.success("Supervisor updated.");
      closeEditModal();
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update supervisor");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setLoading(true);
    try {
      await deleteSupervisor(deleteTarget.id);
      toast.success("Supervisor deleted.");
      closeDeleteModal();
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete supervisor");
    } finally {
      setLoading(false);
    }
  }

  const spinner = (
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
  );

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800">Supervisors</h1>
        <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm p-6 shadow-sm">
          <p className="text-slate-500">
            You do not have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Supervisors</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage supervisors. Add new ones to send them login credentials by
            email. Use the key icon to set or reset a supervisor’s password.
          </p>
        </div>
        <Button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-2"
        >
          <FiUserPlus className="h-5 w-5" />
          Add supervisor
        </Button>
      </div>

      {/* List card */}
      <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-700">
            Existing supervisors
          </h2>
        </div>
        <div className="px-6 py-4">
          {listLoading ? (
            <p className="text-slate-400">Loading…</p>
          ) : list.length === 0 ? (
            <p className="text-slate-400">
              No supervisors yet. Click "Add supervisor" to create one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Email
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Username
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Created
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((s) => (
                    <tr
                      key={s._id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="px-4 py-3 text-slate-700 font-medium">
                        {s.email}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{s.username}</td>
                      <td className="px-4 py-3 text-slate-400">
                        {s.createdAt
                          ? new Date(s.createdAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openPasswordModal(s)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                            aria-label="Set password"
                            title="Set password"
                          >
                            <FiKey className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(s)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                            aria-label="Edit"
                          >
                            <FiEdit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(s)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            aria-label="Delete"
                          >
                            <FiTrash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create supervisor modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div
            className="absolute inset-0 bg-slate-800/40 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-md shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2
                id="modal-title"
                className="text-lg font-semibold text-slate-800"
              >
                Add supervisor
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="Close"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5 p-5">
              <div>
                <label
                  htmlFor="supervisor-username"
                  className="mb-1 block text-sm font-medium text-slate-600"
                >
                  Username
                </label>
                <div className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiUser className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="supervisor-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Display name or login username"
                    autoComplete="username"
                    disabled={loading}
                    className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="supervisor-email"
                  className="mb-1 block text-sm font-medium text-slate-600"
                >
                  Email address
                </label>
                <div className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiMail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="supervisor-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="supervisor@company.com"
                    autoComplete="email"
                    disabled={loading}
                    className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={autoGeneratePassword}
                  onChange={(e) => {
                    setAutoGeneratePassword(e.target.checked);
                    if (e.target.checked) setCreatePassword("");
                  }}
                  disabled={loading}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Auto-generate password
              </label>
              {!autoGeneratePassword && (
                <div>
                  <label
                    htmlFor="create-supervisor-password"
                    className="mb-1 block text-sm font-medium text-slate-600"
                  >
                    Password
                  </label>
                  <input
                    id="create-supervisor-password"
                    type="password"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={loading}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeModal}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>{spinner} Creating…</>
                  ) : (
                    <>
                      <FiUserPlus className="h-5 w-5" />
                      Create
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit supervisor modal */}
      {editId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-modal-title"
        >
          <div
            className="absolute inset-0 bg-slate-800/40 backdrop-blur-sm"
            onClick={closeEditModal}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-md shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2
                id="edit-modal-title"
                className="text-lg font-semibold text-slate-800"
              >
                Edit supervisor
              </h2>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="Close"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-5 p-5">
              <div>
                <label
                  htmlFor="edit-supervisor-email"
                  className="mb-1 block text-sm font-medium text-slate-600"
                >
                  Email address
                </label>
                <div className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiMail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="edit-supervisor-email"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="supervisor@company.com"
                    disabled={loading}
                    className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="edit-supervisor-username"
                  className="mb-1 block text-sm font-medium text-slate-600"
                >
                  Username
                </label>
                <div className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none">
                    <FiUser className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="edit-supervisor-username"
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    placeholder="Display name"
                    disabled={loading}
                    className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeEditModal}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>{spinner} Saving…</>
                  ) : (
                    <>
                      <FiEdit2 className="h-5 w-5" />
                      Save changes
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set password modal */}
      {passwordTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-modal-title"
        >
          <div
            className="absolute inset-0 bg-slate-800/40 backdrop-blur-sm"
            onClick={closePasswordModal}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-md shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2
                id="password-modal-title"
                className="text-lg font-semibold text-slate-800"
              >
                Set password
              </h2>
              <button
                type="button"
                onClick={closePasswordModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="Close"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handlePasswordSubmit} className="space-y-5 p-5">
              <p className="text-sm text-slate-500">
                Set a new login password for{" "}
                <strong className="text-slate-700">{passwordTarget.email}</strong>
                . They can sign in with this password immediately. Minimum 6
                characters.
              </p>
              <div>
                <label
                  htmlFor="supervisor-new-password"
                  className="mb-1 block text-sm font-medium text-slate-600"
                >
                  New password
                </label>
                <input
                  id="supervisor-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={passwordSaving}
                  className="w-full rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label
                  htmlFor="supervisor-confirm-password"
                  className="mb-1 block text-sm font-medium text-slate-600"
                >
                  Confirm password
                </label>
                <input
                  id="supervisor-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={passwordSaving}
                  className="w-full rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closePasswordModal}
                  className="flex-1"
                  disabled={passwordSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={passwordSaving}
                  className="flex-1 inline-flex items-center justify-center gap-2"
                >
                  {passwordSaving ? (
                    <>{spinner} Updating…</>
                  ) : (
                    <>
                      <FiKey className="h-5 w-5" />
                      Update password
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div
            className="absolute inset-0 bg-slate-800/40 backdrop-blur-sm"
            onClick={closeDeleteModal}
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-md shadow-xl p-6">
            <h2
              id="delete-modal-title"
              className="text-lg font-semibold text-slate-800"
            >
              Delete supervisor
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Are you sure you want to delete{" "}
              <strong className="text-slate-700">{deleteTarget.email}</strong>?
              This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={closeDeleteModal}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDeleteConfirm}
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>{spinner} Deleting…</>
                ) : (
                  <>
                    <FiTrash2 className="h-5 w-5" />
                    Delete
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
