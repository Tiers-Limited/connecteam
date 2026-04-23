import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDailyTipsHistory } from '../services/dailyTipService';

const PAGE_SIZES = [10, 25, 50, 100];

function formatDate(d) {
  if (!d) return '–';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return '–';
  return `$${Number(n).toFixed(2)}`;
}

export default function DailyTipsHistory() {
  const { user } = useAuth();
  const [data, setData] = useState({ items: [], total: 0, page: 1, limit: 25 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const result = await getDailyTipsHistory(page, pageSize);
      setData(result || { items: [], total: 0, page: 1, limit: pageSize });
    } catch {
      setData({ items: [], total: 0, page: 1, limit: pageSize });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Daily Tips History</h1>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg backdrop-blur">
          <p className="text-slate-300">Admin access required to view tip history.</p>
        </div>
      </div>
    );
  }

  const { items, total } = data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);

  const spinner = (
    <svg className="mr-2 h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 shadow-2xl sm:p-6">
      <div className="pointer-events-none absolute -top-20 -right-10 h-56 w-56 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative space-y-5">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">
                Corvia Analytics
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
                Daily Tips History
              </h1>
            </div>
            <div className="rounded-full bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-200 ring-1 ring-indigo-400/30">
              Admin View
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-xl backdrop-blur">
          <div className="border-b border-white/10 px-6 pt-5 pb-4">
            <h2 className="text-base font-semibold text-slate-100">Tip entries</h2>
          </div>

          <div className="px-6 py-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-300">
                {total} entr{total === 1 ? 'y' : 'ies'} total
                </span>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="rounded border border-white/15 bg-slate-900/80 px-2 py-1 text-sm text-slate-100 outline-none focus:border-indigo-400"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                </label>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="min-w-[100px] text-center text-slate-300">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-300">
                {spinner}
                Loading…
              </div>
            ) : items.length === 0 ? (
              <p className="py-8 text-center text-slate-400">No tip entries yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] table-auto text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="min-w-[200px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-300">User</th>
                      <th className="min-w-[90px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-300">Role</th>
                      <th className="min-w-[80px] pb-3 pl-2 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-300">AM Tips</th>
                      <th className="min-w-[80px] pb-3 pl-2 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-300">PM Tips</th>
                      <th className="min-w-[80px] pb-3 pl-2 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-300">Total</th>
                      <th className="min-w-[100px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-300">Date</th>
                      <th className="min-w-[100px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-300">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {items.map((row) => {
                      const totalTips = (Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0);
                      const userDisplay = row.createdByUsername
                        ? `${row.createdByUsername} (${row.createdByEmail || '–'})`
                        : row.createdByEmail || '–';
                      const locationName = row.locationId?.name ?? (row.locationId && typeof row.locationId === 'object' ? '–' : row.locationId ?? '–');
                      return (
                        <tr key={row._id} className="transition-colors hover:bg-white/5">
                          <td className="min-w-[200px] py-2.5 pl-2 pr-4 font-medium text-slate-100">{userDisplay}</td>
                          <td className="min-w-[90px] py-2.5 pl-2 pr-4 whitespace-nowrap capitalize text-slate-300">{row.createdByRole || '–'}</td>
                          <td className="min-w-[80px] py-2.5 pl-2 pr-4 text-right tabular-nums whitespace-nowrap text-slate-200">{formatMoney(row.amGrossTips)}</td>
                          <td className="min-w-[80px] py-2.5 pl-2 pr-4 text-right tabular-nums whitespace-nowrap text-slate-200">{formatMoney(row.pmGrossTips)}</td>
                          <td className="min-w-[80px] py-2.5 pl-2 pr-4 text-right font-semibold tabular-nums whitespace-nowrap text-white">{formatMoney(totalTips)}</td>
                          <td className="min-w-[100px] py-2.5 pl-2 pr-4 tabular-nums whitespace-nowrap text-slate-300">{formatDate(row.date)}</td>
                          <td className="min-w-[100px] py-2.5 pl-2 pr-4 text-slate-300">{locationName}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}