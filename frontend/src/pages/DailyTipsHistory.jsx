import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDailyTipsHistory } from '../services/dailyTipService';
import Card from '../components/ui/Card';

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
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Daily Tips History</h1>
        <Card>
          <p className="text-slate-600 dark:text-slate-400">Admin access required to view tip history.</p>
        </Card>
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Daily Tips History</h1>
      <p className="text-slate-600 dark:text-slate-400">
        View who entered each daily tip, the amount, date, and location. Admin only.
      </p>

      <Card title="Tip entries">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {total} entr{total === 1 ? 'y' : 'ies'} total
          </span>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500 dark:text-slate-400">
            {spinner}
            Loading…
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">No tip entries yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-auto text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="min-w-[200px] pb-2 pl-2 pr-4 pt-2 text-left font-medium text-slate-700 dark:text-slate-300">User</th>
                    <th className="min-w-[90px] pb-2 pl-2 pr-4 pt-2 text-left font-medium text-slate-700 dark:text-slate-300">Role</th>
                    <th className="min-w-[80px] pb-2 pl-2 pr-4 pt-2 text-right font-medium text-slate-700 dark:text-slate-300">AM tips</th>
                    <th className="min-w-[80px] pb-2 pl-2 pr-4 pt-2 text-right font-medium text-slate-700 dark:text-slate-300">PM tips</th>
                    <th className="min-w-[80px] pb-2 pl-2 pr-4 pt-2 text-right font-medium text-slate-700 dark:text-slate-300">Total</th>
                    <th className="min-w-[100px] pb-2 pl-2 pr-4 pt-2 text-left font-medium text-slate-700 dark:text-slate-300">Date</th>
                    <th className="min-w-[100px] pb-2 pl-2 pr-4 pt-2 text-left font-medium text-slate-700 dark:text-slate-300">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {items.map((row) => {
                    const totalTips = (Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0);
                    const userDisplay = row.createdByUsername
                      ? `${row.createdByUsername} (${row.createdByEmail || '–'})`
                      : row.createdByEmail || '–';
                    const locationName = row.locationId?.name ?? (row.locationId && typeof row.locationId === 'object' ? '–' : row.locationId ?? '–');
                    return (
                      <tr key={row._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="min-w-[200px] py-2 pl-2 pr-4 font-medium text-slate-800 dark:text-slate-200">{userDisplay}</td>
                        <td className="min-w-[90px] py-2 pl-2 pr-4 capitalize text-slate-600 dark:text-slate-400 whitespace-nowrap">{row.createdByRole || '–'}</td>
                        <td className="min-w-[80px] py-2 pl-2 pr-4 text-right tabular-nums whitespace-nowrap">{formatMoney(row.amGrossTips)}</td>
                        <td className="min-w-[80px] py-2 pl-2 pr-4 text-right tabular-nums whitespace-nowrap">{formatMoney(row.pmGrossTips)}</td>
                        <td className="min-w-[80px] py-2 pl-2 pr-4 text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(totalTips)}</td>
                        <td className="min-w-[100px] py-2 pl-2 pr-4 tabular-nums whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="min-w-[100px] py-2 pl-2 pr-4 text-slate-600 dark:text-slate-400">{locationName}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                Previous
              </button>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                Next
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
