import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { SkeletonPage } from '../skeletons';
import { getDailyTipInput, getDailyTipCalculation, upsertDailyTipInput } from '../services/dailyTipService';
import { toDateString } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

const PAGE_SIZES = [10, 25, 50, 100];

export default function DailyTips() {
  const { selectedLocationId, setSelectedLocationId, locations, dailyTipsCache, setDailyTipsCache } = useApp();
  const [date, setDate] = useState(() => dailyTipsCache?.date || toDateString(new Date()));
  const [input, setInput] = useState(null);
  const [calculation, setCalculation] = useState(() => dailyTipsCache?.calculation ?? null);
  const [calculationError, setCalculationError] = useState(() => dailyTipsCache?.calculationError ?? null);
  const hasCachedResult = !!(dailyTipsCache?.locationId && dailyTipsCache?.date && (dailyTipsCache?.calculation || dailyTipsCache?.calculationError));
  const [loading, setLoading] = useState(!hasCachedResult);
  const [form, setForm] = useState(() => dailyTipsCache?.form || { amGrossTips: '', pmGrossTips: '' });
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const showSkeleton = useDelayedLoading(loading);

  const location = locations.find((l) => l._id === selectedLocationId);

  const load = useCallback(async () => {
    if (!selectedLocationId) return;
    setLoading(true);
    setCalculationError(null);
    try {
      const [tipInput, calc] = await Promise.all([
        getDailyTipInput(selectedLocationId, date).catch(() => null),
        getDailyTipCalculation(selectedLocationId, date).catch(() => ({ error: 'Failed to load calculation' })),
      ]);
      setInput(tipInput || null);
      if (calc?.error) {
        setCalculation(null);
        setCalculationError(calc.error);
      } else {
        setCalculation(calc || null);
        setCalculationError(null);
      }
      if (tipInput) setForm({ amGrossTips: String(tipInput.amGrossTips), pmGrossTips: String(tipInput.pmGrossTips) });
      else setForm({ amGrossTips: '', pmGrossTips: '' });
      setDailyTipsCache((prev) => ({
        ...prev,
        locationId: selectedLocationId,
        date,
        form: tipInput ? { amGrossTips: String(tipInput.amGrossTips), pmGrossTips: String(tipInput.pmGrossTips) } : { amGrossTips: '', pmGrossTips: '' },
        calculation: calc?.error ? null : (calc || null),
        calculationError: calc?.error || null,
      }));
    } catch (e) {
      setCalculationError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [selectedLocationId, date, setDailyTipsCache]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const am = parseFloat(form.amGrossTips);
    const pm = parseFloat(form.pmGrossTips);
    if (isNaN(am) || am < 0) {
      setFormErrors({ amGrossTips: 'Enter a valid amount ≥ 0' });
      toast.error('AM gross tips must be ≥ 0');
      return;
    }
    if (isNaN(pm) || pm < 0) {
      setFormErrors({ pmGrossTips: 'Enter a valid amount ≥ 0' });
      toast.error('PM gross tips must be ≥ 0');
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      await upsertDailyTipInput(selectedLocationId, date, { amGrossTips: am, pmGrossTips: pm });
      toast.success('Tips saved');
      setDailyTipsCache((prev) => ({ ...prev, locationId: selectedLocationId, date, form: { amGrossTips: String(am), pmGrossTips: String(pm) } }));
      await load();
    } catch (err) {
      const details = err.response?.data?.details;
      if (details && Array.isArray(details)) {
        const fieldErrors = {};
        details.forEach((d) => { if (d.field) fieldErrors[d.field] = d.message; });
        setFormErrors(fieldErrors);
        details.forEach((d) => toast.error(d.message));
      }
    } finally {
      setSaving(false);
    }
  };

  const allocations = calculation?.employeeAllocations ?? [];
  const totalRows = allocations.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const pageAllocations = allocations.slice(startIdx, startIdx + pageSize);

  if (!selectedLocationId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Daily Tips</h1>
        <Card>
          <p className="text-slate-600 dark:text-slate-400">Loading locations…</p>
        </Card>
      </div>
    );
  }

  if (showSkeleton && loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Daily Tips</h1>
        <SkeletonPage variant="form" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Daily Tips</h1>
      <p className="text-slate-600 dark:text-slate-400">{location?.name} — Enter gross tips per shift (AM 06:00–15:00, PM 15:00–23:00). 4% is deducted for production pool.</p>

      {/* Tip input — single row */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/30">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Location</label>
            <select
              value={selectedLocationId || ''}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 min-w-[140px]"
            >
              {locations.map((loc) => (
                <option key={loc._id} value={loc._id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">AM Gross Tips ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amGrossTips}
              onChange={(e) => setForm({ ...form, amGrossTips: e.target.value })}
              className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="0"
            />
            {formErrors.amGrossTips && <p className="mt-0.5 text-xs text-red-600">{formErrors.amGrossTips}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">PM Gross Tips ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.pmGrossTips}
              onChange={(e) => setForm({ ...form, pmGrossTips: e.target.value })}
              className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="0"
            />
            {formErrors.pmGrossTips && <p className="mt-0.5 text-xs text-red-600">{formErrors.pmGrossTips}</p>}
          </div>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </form>
      </div>

      {calculationError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-amber-700 dark:text-amber-400">{calculationError}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Enter AM and PM gross tips above and click Save to calculate allocations.</p>
        </div>
      )}

      {calculation && !calculationError && (
        <Card title="Daily calculation (audit)">

          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
              <span>AM distributable: ${calculation.inputs?.distributableAM?.toFixed(2)}</span>
              <span>PM distributable: ${calculation.inputs?.distributablePM?.toFixed(2)}</span>
              <span>AM tip rate: ${calculation.totals?.amTipRate?.toFixed(2)}/hr</span>
              <span>PM tip rate: ${calculation.totals?.pmTipRate?.toFixed(2)}/hr</span>
            </div>
            {totalRows > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500 dark:text-slate-400">{totalRows} employee{totalRows !== 1 ? 's' : ''}</span>
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
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-2 text-left font-medium">Employee</th>
                  <th className="pb-2 text-right font-medium">AM hrs</th>
                  <th className="pb-2 text-right font-medium">PM hrs</th>
                  <th className="pb-2 text-right font-medium">AM tips</th>
                  <th className="pb-2 text-right font-medium">PM tips</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {pageAllocations.map((a) => (
                  <tr key={a.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 font-medium">{a.employeeName}</td>
                    <td className="py-2 text-right tabular-nums">{a.amWorkedHours?.toFixed(2)}</td>
                    <td className="py-2 text-right tabular-nums">{a.pmWorkedHours?.toFixed(2)}</td>
                    <td className="py-2 text-right tabular-nums">${a.amTips?.toFixed(2)}</td>
                    <td className="py-2 text-right tabular-nums">${a.pmTips?.toFixed(2)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">${a.totalTips?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalRows > 0 && (
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
          )}
        </Card>
      )}
    </div>
  );
}
