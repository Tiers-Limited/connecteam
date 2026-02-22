import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { createSupervisor, getSupervisors, updateSupervisor, deleteSupervisor } from '../services/supervisorService';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FiMail, FiUser, FiUserPlus, FiX, FiEdit2, FiTrash2 } from 'react-icons/fi';

export default function CreateSupervisor() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const isAdmin = user?.role === 'admin';

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
    if (!modalOpen && !editId && !deleteTarget) return;
    const onEscape = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        closeEditModal();
        closeDeleteModal();
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [modalOpen, editId, deleteTarget]);

  function openModal() {
    setEmail('');
    setUsername('');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEmail('');
    setUsername('');
  }

  function openEditModal(s) {
    setEditId(s._id);
    setEditEmail(s.email);
    setEditUsername(s.username);
  }

  function closeEditModal() {
    setEditId(null);
    setEditEmail('');
    setEditUsername('');
  }

  function openDeleteModal(s) {
    setDeleteTarget({ id: s._id, email: s.email });
  }

  function closeDeleteModal() {
    setDeleteTarget(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();
    if (!trimmedEmail) {
      toast.error('Email is required');
      return;
    }
    if (!trimmedUsername) {
      toast.error('Username is required');
      return;
    }
    setLoading(true);
    try {
      await createSupervisor(trimmedEmail, trimmedUsername);
      toast.success('Supervisor created. Credentials have been sent to their email.');
      closeModal();
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create supervisor');
    } finally {
      setLoading(false);
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    const trimmedEmail = editEmail.trim();
    const trimmedUsername = editUsername.trim();
    if (!trimmedEmail) {
      toast.error('Email is required');
      return;
    }
    if (!trimmedUsername) {
      toast.error('Username is required');
      return;
    }
    setLoading(true);
    try {
      await updateSupervisor(editId, trimmedEmail, trimmedUsername);
      toast.success('Supervisor updated.');
      closeEditModal();
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update supervisor');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setLoading(true);
    try {
      await deleteSupervisor(deleteTarget.id);
      toast.success('Supervisor deleted.');
      closeDeleteModal();
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete supervisor');
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Supervisors</h1>
        <Card>
          <p className="text-slate-600 dark:text-slate-400">You do not have permission to access this page.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Supervisors</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Manage supervisors. Add new ones to send them login credentials by email.
          </p>
        </div>
        <Button type="button" onClick={openModal} className="inline-flex items-center gap-2">
          <FiUserPlus className="h-5 w-5" />
          Add supervisor
        </Button>
      </div>

      <Card title="Existing supervisors">
        {listLoading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400">No supervisors yet. Click “Add supervisor” to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Username</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Created</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {list.map((s) => (
                  <tr key={s._id} className="text-sm">
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{s.email}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{s.username}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(s)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-indigo-400"
                          aria-label="Edit"
                        >
                          <FiEdit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteModal(s)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-red-400"
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
      </Card>

      {/* Create supervisor modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h2 id="modal-title" className="text-lg font-semibold text-slate-800 dark:text-slate-200">Add supervisor</h2>
              <button type="button" onClick={closeModal} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300" aria-label="Close">
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5 p-5">
              <p className="text-sm text-slate-600 dark:text-slate-400">A password will be generated and sent to their email.</p>
              <div>
                <label htmlFor="supervisor-email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Email address</label>
                <div className="relative flex items-center rounded-lg border border-slate-300 bg-white shadow-sm transition-colors focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:focus-within:border-indigo-500">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none"><FiMail className="h-5 w-5 text-slate-400" /></div>
                  <input id="supervisor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="supervisor@company.com" autoComplete="email" disabled={loading} className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500" />
                </div>
              </div>
              <div>
                <label htmlFor="supervisor-username" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                <div className="relative flex items-center rounded-lg border border-slate-300 bg-white shadow-sm transition-colors focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:focus-within:border-indigo-500">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none"><FiUser className="h-5 w-5 text-slate-400" /></div>
                  <input id="supervisor-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Display name or login username" autoComplete="username" disabled={loading} className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button type="button" variant="secondary" onClick={closeModal} className="flex-1">Cancel</Button>
                <Button type="submit" disabled={loading} className="flex-1 inline-flex items-center justify-center gap-2">
                  {loading ? (<><svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Creating…</>) : (<> <FiUserPlus className="h-5 w-5" />Create</>)}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit supervisor modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeEditModal} />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h2 id="edit-modal-title" className="text-lg font-semibold text-slate-800 dark:text-slate-200">Edit supervisor</h2>
              <button type="button" onClick={closeEditModal} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300" aria-label="Close">
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-5 p-5">
              <div>
                <label htmlFor="edit-supervisor-email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Email address</label>
                <div className="relative flex items-center rounded-lg border border-slate-300 bg-white shadow-sm transition-colors focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:focus-within:border-indigo-500">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none"><FiMail className="h-5 w-5 text-slate-400" /></div>
                  <input id="edit-supervisor-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="supervisor@company.com" disabled={loading} className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500" />
                </div>
              </div>
              <div>
                <label htmlFor="edit-supervisor-username" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                <div className="relative flex items-center rounded-lg border border-slate-300 bg-white shadow-sm transition-colors focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:focus-within:border-indigo-500">
                  <div className="absolute left-0 pl-3 flex items-center pointer-events-none"><FiUser className="h-5 w-5 text-slate-400" /></div>
                  <input id="edit-supervisor-username" type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} placeholder="Display name" disabled={loading} className="w-full rounded-lg border-0 bg-transparent py-2 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button type="button" variant="secondary" onClick={closeEditModal} className="flex-1">Cancel</Button>
                <Button type="submit" disabled={loading} className="flex-1 inline-flex items-center justify-center gap-2">
                  {loading ? (<><svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Saving…</>) : (<> <FiEdit2 className="h-5 w-5" />Save changes</>)}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeDeleteModal} />
          <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 p-6">
            <h2 id="delete-modal-title" className="text-lg font-semibold text-slate-800 dark:text-slate-200">Delete supervisor</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Are you sure you want to delete <strong className="text-slate-800 dark:text-slate-200">{deleteTarget.email}</strong>? This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <Button type="button" variant="secondary" onClick={closeDeleteModal} className="flex-1">Cancel</Button>
              <Button type="button" variant="danger" onClick={handleDeleteConfirm} disabled={loading} className="flex-1 inline-flex items-center justify-center gap-2">
                {loading ? (<><svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Deleting…</>) : (<> <FiTrash2 className="h-5 w-5" />Delete</>)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
