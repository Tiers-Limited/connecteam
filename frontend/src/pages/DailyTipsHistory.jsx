import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDailyTipsHistory } from '../services/dailyTipService';
import { exportTableToCSV, exportTableToPDF, formatCsvNumeric } from '../utils/reportUtils';
import Button from '../components/ui/Button';

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
        <h1 className="text-2xl font-bold text-slate-800">Daily Tips History</h1>
        <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm p-6 shadow-sm">
          <p className="text-slate-500">Admin access required to view tip history.</p>
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

  const exportHeaders = ['User', 'Role', 'AM Tips', 'PM Tips', 'Total', 'Date', 'Location'];

  function buildExportRows(sourceItems, forCsv = false) {
    return sourceItems.map((row) => {
      const totalTips = (Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0);
      const userDisplay = row.createdByUsername
        ? `${row.createdByUsername} (${row.createdByEmail || ''})`
        : row.createdByEmail || '';
      const locationName = row.locationId?.name ?? (row.locationId && typeof row.locationId === 'object' ? '' : row.locationId ?? '');
      const moneyCell = (n) =>
        forCsv ? formatCsvNumeric(n, { maxFractionDigits: 2 }) : formatMoney(n);
      return [
        userDisplay,
        row.createdByRole || '',
        moneyCell(row.amGrossTips),
        moneyCell(row.pmGrossTips),
        moneyCell(totalTips),
        formatDate(row.date),
        locationName,
      ];
    });
  }

  async function handleExportCSV() {
    // Export all pages: fetch with large limit
    try {
      const all = await getDailyTipsHistory(1, 10000);
      const rows = buildExportRows(all?.items ?? items, true);
      exportTableToCSV(exportHeaders, rows, `daily-tips-history.csv`);
    } catch {
      // fallback to current page
      exportTableToCSV(exportHeaders, buildExportRows(items, true), `daily-tips-history.csv`);
    }
  }

  async function handleExportPDF() {
    try {
      const all = await getDailyTipsHistory(1, 10000);
      const rows = buildExportRows(all?.items ?? items, false);
      exportTableToPDF('Daily Tips History', exportHeaders, rows, `daily-tips-history.pdf`);
    } catch {
      exportTableToPDF('Daily Tips History', exportHeaders, buildExportRows(items, false), `daily-tips-history.pdf`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Daily Tips History</h1>
          <p className="mt-1 text-sm text-slate-500">
            View who entered each daily tip, the amount, date, and location. Admin only.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-700">Tip entries</h2>
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-500">
                {total} entr{total === 1 ? 'y' : 'ies'} total
              </span>
              <label className="flex items-center gap-2 text-sm text-slate-500">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="rounded border border-slate-200 bg-white/90 px-2 py-1 text-sm text-slate-700"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              {!loading && items.length > 0 && (
                <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                  <span className="text-xs font-medium text-slate-400">Report:</span>
                  <Button type="button" variant="secondary" onClick={handleExportCSV}>
                    Export CSV
                  </Button>
                  <Button type="button" variant="secondary" onClick={handleExportPDF}>
                    Export PDF
                  </Button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="min-w-[100px] text-center text-slate-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              {spinner}
              Loading…
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-slate-400">No tip entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-auto text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="min-w-[200px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
                    <th className="min-w-[90px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
                    <th className="min-w-[80px] pb-3 pl-2 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">AM Tips</th>
                    <th className="min-w-[80px] pb-3 pl-2 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">PM Tips</th>
                    <th className="min-w-[80px] pb-3 pl-2 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Total</th>
                    <th className="min-w-[100px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                    <th className="min-w-[100px] pb-3 pl-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row) => {
                    const totalTips = (Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0);
                    const userDisplay = row.createdByUsername
                      ? `${row.createdByUsername} (${row.createdByEmail || '–'})`
                      : row.createdByEmail || '–';
                    const locationName = row.locationId?.name ?? (row.locationId && typeof row.locationId === 'object' ? '–' : row.locationId ?? '–');
                    return (
                      <tr key={row._id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="min-w-[200px] py-2.5 pl-2 pr-4 font-medium text-slate-700">{userDisplay}</td>
                        <td className="min-w-[90px] py-2.5 pl-2 pr-4 capitalize text-slate-500 whitespace-nowrap">{row.createdByRole || '–'}</td>
                        <td className="min-w-[80px] py-2.5 pl-2 pr-4 text-right tabular-nums whitespace-nowrap text-slate-600">{formatMoney(row.amGrossTips)}</td>
                        <td className="min-w-[80px] py-2.5 pl-2 pr-4 text-right tabular-nums whitespace-nowrap text-slate-600">{formatMoney(row.pmGrossTips)}</td>
                        <td className="min-w-[80px] py-2.5 pl-2 pr-4 text-right font-semibold tabular-nums whitespace-nowrap text-slate-700">{formatMoney(totalTips)}</td>
                        <td className="min-w-[100px] py-2.5 pl-2 pr-4 tabular-nums whitespace-nowrap text-slate-500">{formatDate(row.date)}</td>
                        <td className="min-w-[100px] py-2.5 pl-2 pr-4 text-slate-500">{locationName}</td>
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
  );
}