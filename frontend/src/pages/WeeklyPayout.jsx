import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { SkeletonPage } from '../skeletons';
import { getWeeklyPayout, getManualDeductions, upsertTardiness, upsertManualDeduction } from '../services/weeklyPayoutService';
import { getWeekStart, toDateString, formatWeekRange } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

const PAGE_SIZES = [10, 25, 50, 100];

export default function WeeklyPayout() {
  const { selectedLocationId, setSelectedLocationId, locations } = useApp();
  const [weekStart, setWeekStart] = useState(() => toDateString(getWeekStart(new Date())));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tardinessEdits, setTardinessEdits] = useState({});
  const [manualEdits, setManualEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const showSkeleton = useDelayedLoading(loading);

  const loadPayout = useCallback(() => {
    if (!selectedLocationId) {
      toast.error('Select a location first');
      return;
    }
    setLoading(true);
    setData(null);
    getWeeklyPayout(selectedLocationId, weekStart)
      .then((res) => {
        setData(res);
        setPage(1);
      })
      .catch(() => {
        setData(null);
        toast.error('Failed to load payout');
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId, weekStart]);

  useEffect(() => {
    if (!selectedLocationId || !data?.payouts?.length) return;
    const t = {};
    const m = {};
    data.payouts.forEach((p) => {
      t[p.employeeId] = String(p.weeklyTardinessMinutes ?? 0);
      m[p.employeeId] = { amount: String(p.manualDeduction ?? 0), reason: '' };
    });
    setTardinessEdits(t);
    setManualEdits(m);
    getManualDeductions(selectedLocationId, weekStart).then((list) => {
      const next = { ...m };
      list.forEach((r) => {
        const id = r.employeeId?._id || r.employeeId;
        if (id) next[id] = { amount: String(r.amount ?? 0), reason: r.reason || '' };
      });
      setManualEdits(next);
    }).catch(() => {});
  }, [selectedLocationId, weekStart, data?.payouts]);

  const location = locations.find((l) => l._id === selectedLocationId);
  const payouts = data?.payouts ?? [];
  const totalRows = payouts.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const paginatedPayouts = payouts.slice(start, start + pageSize);

  if (!selectedLocationId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Weekly Payout</h1>
        <Card>
          <p className="text-slate-600 dark:text-slate-400">Select a location to view weekly payout.</p>
        </Card>
      </div>
    );
  }

  if (showSkeleton && loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Weekly Payout</h1>
        <SkeletonPage variant="table" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Weekly Payout</h1>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Location</label>
            <select
              value={selectedLocationId || ''}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {locations.map((loc) => (
                <option key={loc._id} value={loc._id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Week (Mon–Sun)</label>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <Button
            onClick={loadPayout}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load payout'}
          </Button>
        </div>
      </div>

      <p className="text-slate-600 dark:text-slate-400">
        {location?.name} — {formatWeekRange(weekStart)}. Tardiness: 0–5 min 0%, &gt;5–10 min 15%, &gt;10 min 20%. Redistribution to eligible staff.
      </p>

      {!data && !loading && (
        <Card>
          <p className="py-6 text-center text-slate-500 dark:text-slate-400">
            Select location and week, then click <strong>Load payout</strong> to fetch data.
          </p>
        </Card>
      )}

      {data && (
        <Card title="Staff payout table">
          {totalRows > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {totalRows} employee{totalRows !== 1 ? 's' : ''}
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
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  Previous
                </button>
                <span className="text-slate-600 dark:text-slate-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="whitespace-nowrap pb-3 text-left font-semibold text-slate-700 dark:text-slate-300">Employee</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Daily Tips (Mon–Sun)</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Tardiness (min)</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Tardiness %</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Tardiness Deduction</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Manual Deduction</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Net Weekly Tips</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Redistribution</th>
                  <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">Final Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {paginatedPayouts.map((p) => (
                  <tr key={p.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2.5 font-medium">{p.employeeName}</td>
                    <td className="py-2.5 text-right tabular-nums">${Number(p.dailyTipsMonToSun).toFixed(2)}</td>
                    <td className="py-2.5 text-right tabular-nums">{p.weeklyTardinessMinutes}</td>
                    <td className="py-2.5 text-right tabular-nums">{p.tardinessPercent}%</td>
                    <td className="py-2.5 text-right tabular-nums">${Number(p.tardinessDeduction).toFixed(2)}</td>
                    <td className="py-2.5 text-right tabular-nums">${Number(p.manualDeduction).toFixed(2)}</td>
                    <td className="py-2.5 text-right tabular-nums">${Number(p.netWeeklyTips).toFixed(2)}</td>
                    <td className="py-2.5 text-right tabular-nums">${Number(p.tardinessRedistribution).toFixed(2)}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">${Number(p.finalWeeklyTipsPayable).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalRows === 0 && (
            <p className="py-8 text-center text-slate-500 dark:text-slate-400">
              No payout data for this week. Ensure daily tips are entered for the week, then load again.
            </p>
          )}
        </Card>
      )}

      {data && payouts.length > 0 && (
        <Card title="Tardiness & manual deductions (admin)">
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
            Set weekly tardiness minutes (0–5: 0%, &gt;5–10: 15%, &gt;10: 20%) and optional manual deduction with reason.
          </p>
          {totalRows > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {totalRows} employee{totalRows !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  Previous
                </button>
                <span className="text-slate-600 dark:text-slate-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-2 text-left font-medium text-slate-700 dark:text-slate-300">Employee</th>
                  <th className="pb-2 text-right font-medium text-slate-700 dark:text-slate-300">Tardiness (min)</th>
                  <th className="pb-2 text-right font-medium text-slate-700 dark:text-slate-300">Manual $</th>
                  <th className="pb-2 text-left font-medium text-slate-700 dark:text-slate-300">Reason</th>
                  <th className="pb-2 text-right font-medium text-slate-700 dark:text-slate-300">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {paginatedPayouts.map((p) => (
                  <tr key={p.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 font-medium">{p.employeeName}</td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={tardinessEdits[p.employeeId] ?? ''}
                        onChange={(e) => setTardinessEdits((prev) => ({ ...prev, [p.employeeId]: e.target.value }))}
                        className="w-16 rounded border border-slate-300 bg-white px-2 py-1.5 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={manualEdits[p.employeeId]?.amount ?? ''}
                        onChange={(e) => setManualEdits((prev) => ({ ...prev, [p.employeeId]: { ...prev[p.employeeId], amount: e.target.value } }))}
                        className="w-20 rounded border border-slate-300 bg-white px-2 py-1.5 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="text"
                        placeholder="Reason if deduction"
                        value={manualEdits[p.employeeId]?.reason ?? ''}
                        onChange={(e) => setManualEdits((prev) => ({ ...prev, [p.employeeId]: { ...prev[p.employeeId], reason: e.target.value } }))}
                        className="w-full max-w-xs rounded border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="secondary"
                        disabled={saving}
                        onClick={async () => {
                          const amt = parseFloat(manualEdits[p.employeeId]?.amount) || 0;
                          const reason = (manualEdits[p.employeeId]?.reason || '').trim();
                          if (amt > 0 && !reason) {
                            toast.error('Reason is required when manual deduction > 0');
                            return;
                          }
                          setSaving(true);
                          try {
                            const tardMin = parseInt(tardinessEdits[p.employeeId], 10) || 0;
                            await upsertTardiness({ employeeId: p.employeeId, locationId: selectedLocationId, weekStart, totalTardinessMinutes: tardMin });
                            await upsertManualDeduction({ employeeId: p.employeeId, locationId: selectedLocationId, weekStart, amount: amt, reason: amt > 0 ? reason : '' });
                            toast.success(`Saved for ${p.employeeName}`);
                            loadPayout();
                          } catch (e) {
                            if (e.response?.data?.details) e.response.data.details.forEach((d) => toast.error(d.message));
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        Save
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
