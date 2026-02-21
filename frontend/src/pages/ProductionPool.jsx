import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  getWeeklyProductionPayout,
  getProductionManualDeductions,
  getLocationWiseProductionPool,
  upsertProductionManualDeduction,
  updateProductionStaff,
} from '../services/productionService';
import { getWeekStart, getWeekEnd, toLocalDateString, formatWeekRange, getWeekDateColumns, getDateRangeColumns } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

function formatMoney(n) {
  return '$' + (Number(n) ?? 0).toFixed(2);
}

function getDefaultDateRange() {
  const mon = getWeekStart(new Date());
  const sun = getWeekEnd(mon);
  return { start: toLocalDateString(mon), end: toLocalDateString(sun) };
}

export default function ProductionPool() {
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modalRow, setModalRow] = useState(null);
  const [editAllocationPercent, setEditAllocationPercent] = useState('');
  const [editSubjectToTardiness, setEditSubjectToTardiness] = useState(true);
  const [editManualAmount, setEditManualAmount] = useState('');
  const [editManualReason, setEditManualReason] = useState('');
  const [manualEdits, setManualEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [locationWisePool, setLocationWisePool] = useState([]);

  const loadPayout = useCallback(() => {
    const start = startDate.trim().slice(0, 10);
    const end = endDate.trim().slice(0, 10);
    if (!start || !end || new Date(end + 'T12:00:00') < new Date(start + 'T12:00:00')) {
      toast.error('Please select a valid date range (From ≤ To).');
      return;
    }
    setLoading(true);
    Promise.all([
      getWeeklyProductionPayout(start, start, end),
      getLocationWiseProductionPool(start, start, end),
    ])
      .then(([res, locationList]) => {
        setData(res);
        setLocationWisePool(Array.isArray(locationList) ? locationList : []);
        toast.success(`Loaded production payout for ${res?.payouts?.length ?? 0} staff.`);
      })
      .catch(() => {
        setData(null);
        setLocationWisePool([]);
        toast.error('Failed to load production payout');
      })
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  const getStaffId = (p) => (p?.productionStaffId?._id ?? p?.productionStaffId);

  const openModal = useCallback((p) => {
    setModalRow(p);
    setEditAllocationPercent(String(p.allocationPercent ?? 0));
    setEditSubjectToTardiness(p.subjectToTardiness !== false);
    setEditManualAmount(String(p.manualDeduction ?? 0));
    setEditManualReason(manualEdits[getStaffId(p)]?.reason ?? '');
  }, [manualEdits]);

  const closeModal = useCallback(() => setModalRow(null), []);

  const handleSave = useCallback(async () => {
    if (!modalRow) return;
    const staffId = getStaffId(modalRow);
    if (!staffId) {
      toast.error('Invalid staff');
      return;
    }
    const amt = parseFloat(editManualAmount) || 0;
    const reason = editManualReason.trim();
    if (amt > 0 && !reason) {
      toast.error('Reason is required when manual deduction > 0');
      return;
    }
    const alloc = parseFloat(editAllocationPercent);
    if (isNaN(alloc) || alloc < 0 || alloc > 100) {
      toast.error('Allocation % must be between 0 and 100');
      return;
    }
    setSaving(true);
    try {
      await updateProductionStaff(staffId, {
        allocationPercent: alloc,
        subjectToTardiness: editSubjectToTardiness,
      });
      await upsertProductionManualDeduction({
        productionStaffId: staffId,
        weekStart: startDate.trim().slice(0, 10),
        amount: amt,
        reason: amt > 0 ? reason : '',
      });
      toast.success(`Saved for ${modalRow.name}`);
      closeModal();
      loadPayout();
    } catch (e) {
      if (e.response?.data?.details) {
        e.response.data.details.forEach((d) => toast.error(d.message));
      } else {
        toast.error(e.response?.data?.error || 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  }, [modalRow, startDate, editAllocationPercent, editSubjectToTardiness, editManualAmount, editManualReason, closeModal, loadPayout]);

  useEffect(() => {
    if (!data?.payouts?.length) return;
    const m = {};
    data.payouts.forEach((p) => {
      const id = getStaffId(p);
      if (id) m[id] = { amount: String(p.manualDeduction ?? 0), reason: '' };
    });
    setManualEdits(m);
    getProductionManualDeductions(startDate.trim().slice(0, 10))
      .then((list) => {
        const next = { ...m };
        list.forEach((r) => {
          const id = r.productionStaffId?._id || r.productionStaffId;
          if (id) next[id] = { amount: String(r.amount ?? 0), reason: r.reason || '' };
        });
        setManualEdits(next);
      })
      .catch(() => {});
  }, [startDate, data?.payouts]);

  useEffect(() => {
    if (!modalRow) return;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [modalRow, closeModal]);

  const payouts = data?.payouts ?? [];
  const totalPoolFromLocations = locationWisePool.reduce((sum, row) => sum + (Number(row.weeklyPool) || 0), 0);
  const totalToDistribute = Number(data?.redistributionPool) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Production Pool
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Select <strong>From date</strong> and <strong>To date</strong>, then click <strong>Load payout</strong>. Tardiness is pulled from ConnectTeam for the selected range (all locations). 4% of gross tips forms the daily pool.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">
              From date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">
              To date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <Button onClick={loadPayout} disabled={loading}>
            {loading ? 'Loading…' : 'Load payout'}
          </Button>
        </div>
      </div>

      {data && (
        <>
          <Card className="border-l-4 border-l-amber-500 bg-slate-50 dark:bg-slate-800/50">
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {startDate.trim().slice(0, 10)} – {endDate.trim().slice(0, 10)} — Production (all locations)
            </p>
            <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
              {locationWisePool.length > 0 && (
                <p>
                  <span className="font-medium text-slate-700 dark:text-slate-300">4% from each location:</span>{' '}
                  {locationWisePool.map((row) => `${row.locationName}: ${formatMoney(row.weeklyPool ?? 0)}`).join(' · ')}
                </p>
              )}
              <p>
                <span className="font-medium text-slate-700 dark:text-slate-300">Total pool (4% all locations):</span>{' '}
                <strong className="text-slate-800 dark:text-slate-100">{formatMoney(totalPoolFromLocations)}</strong>
              </p>
              <p>
                <span className="font-medium text-slate-700 dark:text-slate-300">Total to distribute:</span>{' '}
                <strong className="text-emerald-700 dark:text-emerald-300">{formatMoney(totalToDistribute)}</strong>
                {' '}(redistribution pool to eligible staff after tardiness deductions)
              </p>
            </div>
          </Card>

          <Card title="Weekly Production Payout Table">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="w-12 pb-3 pr-2 text-center font-semibold text-slate-700 dark:text-slate-300">Action</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-left font-semibold text-slate-700 dark:text-slate-300">Employee</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">Allocation %</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">Gross Production Tips</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">Weekly Tardiness (min)</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">Tardiness %</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">Tardiness Deduction</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">Manual Deduction</th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">Redistribution Received</th>
                    <th className="whitespace-nowrap pb-3 pl-4 text-right font-semibold text-slate-700 dark:text-slate-300">Final Weekly Production Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {payouts.map((p) => (
                    <tr key={p.productionStaffId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="w-12 py-3 pr-2 text-center">
                        <button
                          type="button"
                          onClick={() => openModal(p)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-amber-900/30 dark:hover:border-amber-600 dark:hover:text-amber-300"
                          title="Edit allocation & manual deduction"
                        >
                          Edit
                        </button>
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-800 dark:text-slate-100">
                        {p.name}
                        {!p.subjectToTardiness && (
                          <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">(exempt)</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">{p.allocationPercent ?? 0}%</td>
                      <td className="py-3 pr-4 text-right tabular-nums font-medium">
                        {formatMoney(p.weeklyGrossProductionTips)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">{p.weeklyTardinessMinutes ?? 0}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{p.tardinessPercent ?? 0}%</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-amber-700 dark:text-amber-400">
                        {formatMoney(p.tardinessDeduction)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">{formatMoney(p.manualDeduction)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatMoney(p.tardinessRedistribution ?? 0)}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(p.finalWeeklyProductionPayout ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {payouts.length === 0 && (
              <p className="py-8 text-center text-slate-500 dark:text-slate-400">
                No production staff configured or no pool data for this week. Seed production staff (Marina, Laura, Bruna) and enter daily tips for all locations.
              </p>
            )}
          </Card>

          <Card title="Location-wise tip pool">
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              4% of gross tips (AM + PM) per location for the selected date range. Combined across locations = total production pool.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="whitespace-nowrap pb-3 pr-4 text-left font-semibold text-slate-700 dark:text-slate-300">Location</th>
                    {(data?.dateRange ? getDateRangeColumns(data.dateRange.startDate, data.dateRange.endDate) : getWeekDateColumns(startDate)).map((col) => (
                      <th key={col.dateKey} className="whitespace-nowrap pb-3 pr-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                        {col.label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap pb-3 pl-3 text-right font-semibold text-slate-700 dark:text-slate-300">Weekly total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {locationWisePool.map((row) => (
                    <tr key={row.locationId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-3 pr-4 font-medium text-slate-800 dark:text-slate-100">{row.locationName}</td>
                      {(row.dailyByDay || []).map((val, i) => (
                        <td key={i} className="py-3 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {formatMoney(val)}
                        </td>
                      ))}
                      <td className="py-3 pl-3 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(row.weeklyPool ?? 0)}
                      </td>
                    </tr>
                  ))}
                  {locationWisePool.length > 0 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold dark:border-slate-600 dark:bg-slate-800/70">
                      <td className="py-3 pr-4 text-slate-800 dark:text-slate-100">Total</td>
                      {(data?.dateRange ? getDateRangeColumns(data.dateRange.startDate, data.dateRange.endDate) : getWeekDateColumns(startDate)).map((_, i) => (
                        <td key={i} className="py-3 pr-3 text-right tabular-nums text-slate-800 dark:text-slate-100">
                          {formatMoney(locationWisePool.reduce((s, row) => s + (Number((row.dailyByDay || [])[i]) || 0), 0))}
                        </td>
                      ))}
                      <td className="py-3 pl-3 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {formatMoney(totalPoolFromLocations)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {locationWisePool.length === 0 && (
              <p className="py-6 text-center text-slate-500 dark:text-slate-400">
                No daily tips entered for this week at any location. Enter tips on Daily Tips to see location-wise pool.
              </p>
            )}
          </Card>
        </>
      )}

      {!data && !loading && (
        <Card>
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">
            Select date range (From and To) and click <strong>Load payout</strong> to load production payout from ConnectTeam for that range. Ensure daily tips are entered for all locations (4% forms the pool).
          </p>
        </Card>
      )}

      {modalRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="production-modal-title"
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="production-modal-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Allocation & deductions — {modalRow.name}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Tardiness from Weekly Tardiness (all locations). Reason required if manual deduction &gt; 0.
            </p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Allocation %
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={editAllocationPercent}
                  onChange={(e) => setEditAllocationPercent(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="subjectToTardiness"
                  checked={editSubjectToTardiness}
                  onChange={(e) => setEditSubjectToTardiness(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="subjectToTardiness" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Subject to tardiness (uncheck for senior/exempt)
                </label>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Weekly tardiness (min)
                </label>
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {modalRow.weeklyTardinessMinutes ?? 0} min (from Weekly Tardiness)
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Manual deduction ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editManualAmount}
                  onChange={(e) => setEditManualAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Reason <span className="text-slate-400">(required if amount &gt; 0)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Uniform, equipment"
                  value={editManualReason}
                  onChange={(e) => setEditManualReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
