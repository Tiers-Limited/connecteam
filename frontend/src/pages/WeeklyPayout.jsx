import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { SkeletonPage } from '../skeletons';
import {
  getWeeklyPayout,
  getManualDeductions,
  upsertTardiness,
  upsertManualDeduction,
} from '../services/weeklyPayoutService';
import { getWeekStart, toDateString, formatWeekRange } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

const PAGE_SIZES = [10, 25, 50, 100];
const STORAGE_KEY = 'weeklyPayout_data';
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function loadPersistedData() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersistedData(data) {
  try {
    if (data) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

function formatMoney(n) {
  return '$' + (Number(n) ?? 0).toFixed(2);
}

export default function WeeklyPayout() {
  const { selectedLocationId, setSelectedLocationId, locations } = useApp();
  const [weekStart, setWeekStart] = useState(() =>
    toDateString(getWeekStart(new Date()))
  );
  const [data, setData] = useState(loadPersistedData);
  const [loading, setLoading] = useState(false);
  const [tardinessEdits, setTardinessEdits] = useState({});
  const [manualEdits, setManualEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [modalEmployee, setModalEmployee] = useState(null);
  const [editTardiness, setEditTardiness] = useState('');
  const [editManualAmount, setEditManualAmount] = useState('');
  const [editManualReason, setEditManualReason] = useState('');
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
        toast.success(`Loaded payout for ${res?.payouts?.length ?? 0} employees.`);
      })
      .catch(() => {
        setData(null);
        toast.error('Failed to load payout');
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId, weekStart]);

  const openDeductionModal = useCallback((p) => {
    setModalEmployee(p);
    setEditTardiness(String(p.weeklyTardinessMinutes ?? 0));
    setEditManualAmount(String(p.manualDeduction ?? 0));
    setEditManualReason(manualEdits[p.employeeId]?.reason ?? '');
  }, [manualEdits]);

  const closeModal = useCallback(() => {
    setModalEmployee(null);
  }, []);

  const handleSaveDeductions = useCallback(async () => {
    if (!modalEmployee || !selectedLocationId) return;
    const amt = parseFloat(editManualAmount) || 0;
    const reason = editManualReason.trim();
    if (amt > 0 && !reason) {
      toast.error('Reason is required when manual deduction > 0');
      return;
    }
    setSaving(true);
    try {
      const tardMin = parseInt(editTardiness, 10) || 0;
      await upsertTardiness({
        employeeId: modalEmployee.employeeId,
        locationId: selectedLocationId,
        weekStart,
        totalTardinessMinutes: tardMin,
      });
      await upsertManualDeduction({
        employeeId: modalEmployee.employeeId,
        locationId: selectedLocationId,
        weekStart,
        amount: amt,
        reason: amt > 0 ? reason : '',
      });
      toast.success(`Saved for ${modalEmployee.employeeName}`);
      closeModal();
      loadPayout();
    } catch (e) {
      if (e.response?.data?.details)
        e.response.data.details.forEach((d) => toast.error(d.message));
    } finally {
      setSaving(false);
    }
  }, [modalEmployee, selectedLocationId, weekStart, editTardiness, editManualAmount, editManualReason, closeModal, loadPayout]);

  useEffect(() => {
    savePersistedData(data);
  }, [data]);

  useEffect(() => {
    if (!modalEmployee) return;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [modalEmployee, closeModal]);

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
    getManualDeductions(selectedLocationId, weekStart)
      .then((list) => {
        const next = { ...m };
        list.forEach((r) => {
          const id = r.employeeId?._id || r.employeeId;
          if (id) next[id] = { amount: String(r.amount ?? 0), reason: r.reason || '' };
        });
        setManualEdits(next);
      })
      .catch(() => {});
  }, [selectedLocationId, weekStart, data?.payouts]);

  const location = locations.find((l) => l._id === selectedLocationId);
  const payouts = data?.payouts ?? [];
  const locationName = data?.locationName ?? location?.name ?? '—';
  const totalRows = payouts.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const paginatedPayouts = payouts.slice(start, start + pageSize);

  if (!selectedLocationId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          Weekly Staff Payout
        </h1>
        <Card>
          <p className="text-slate-600 dark:text-slate-400">
            Select a location to view weekly payout.
          </p>
        </Card>
      </div>
    );
  }

  if (showSkeleton && loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          Weekly Staff Payout
        </h1>
        <SkeletonPage variant="table" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Weekly Staff Payout
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Phase 2: Weekly aggregation → Tardiness deduction → Weekly after tardiness
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Location
            </label>
            <select
              value={selectedLocationId || ''}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {locations.map((loc) => (
                <option key={loc._id} value={loc._id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Week (Mon–Sun)
            </label>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <Button onClick={loadPayout} disabled={loading}>
            {loading ? 'Loading…' : 'Load payout'}
          </Button>
        </div>
      </div>

      <Card className="border-l-4 border-l-indigo-500 bg-slate-50 dark:bg-slate-800/50">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {locationName} — {formatWeekRange(weekStart)}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Weekly Gross Tips = Σ Daily Tips (Mon–Sun). Tardiness: 0–5 min → 0%; &gt;5–10 min → 15%; &gt;10 min → 20%. One tier per week. Values are system-generated and auditable.
            </p>
          </div>
        </div>
      </Card>

      {!data && !loading && (
        <Card>
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">
            Select location and week, then click <strong>Load payout</strong> to fetch data. Ensure daily tips are entered for the week (Phase 1).
          </p>
        </Card>
      )}

      {data && (
        <>
          <Card title="Weekly Staff Payout Table">
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
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Previous
                  </button>
                  <span className="min-w-[100px] text-center text-slate-600 dark:text-slate-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="w-12 whitespace-nowrap pb-3 pr-2 text-center font-semibold text-slate-700 dark:text-slate-300">
                      Action
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-left font-semibold text-slate-700 dark:text-slate-300">
                      Employee
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-left font-semibold text-slate-700 dark:text-slate-300">
                      Location
                    </th>
                    {DAY_LABELS.map((label) => (
                      <th
                        key={label}
                        className="whitespace-nowrap pb-3 pr-2 text-right font-semibold text-slate-700 dark:text-slate-300"
                        title={`Tips for ${label}`}
                      >
                        {label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300" title="Σ Daily Tips (Mon–Sun), basis for deductions">
                      Weekly Gross Tips
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Weekly Tardiness (min)
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Tardiness %
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Tardiness Deduction
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Weekly After Tardiness
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Manual Deduction
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Net Weekly Tips
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Redistribution
                    </th>
                    <th className="whitespace-nowrap pb-3 pl-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Final Payable
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {paginatedPayouts.map((p) => (
                    <tr
                      key={p.employeeId}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="w-12 py-3 pr-2 text-center">
                        <button
                          type="button"
                          onClick={() => openDeductionModal(p)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-indigo-900/30 dark:hover:border-indigo-600 dark:hover:text-indigo-300"
                          title="Tardiness & manual deduction"
                        >
                          Edit
                        </button>
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-800 dark:text-slate-100">
                        {p.employeeName}
                      </td>
                      <td className="py-3 pr-4 text-slate-600 dark:text-slate-400">
                        {locationName}
                      </td>
                      {(p.dailyTipsByDay || [0, 0, 0, 0, 0, 0, 0]).map((dayTips, idx) => (
                        <td key={DAY_LABELS[idx]} className="py-3 pr-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {formatMoney(dayTips)}
                        </td>
                      ))}
                      <td className="py-3 pr-4 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200" title="Sum of Mon–Sun">
                        {formatMoney(p.weeklyGrossTips ?? p.dailyTipsMonToSun)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {p.weeklyTardinessMinutes ?? 0}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {p.tardinessPercent ?? 0}%
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-amber-700 dark:text-amber-400">
                        {formatMoney(p.tardinessDeduction)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">
                        {formatMoney(p.weeklyAfterTardiness)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {formatMoney(p.manualDeduction)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {formatMoney(p.netWeeklyTips)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatMoney(p.tardinessRedistribution)}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(p.finalWeeklyTipsPayable)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalRows === 0 && (
              <p className="py-8 text-center text-slate-500 dark:text-slate-400">
                No payout data for this week. Enter daily tips (Phase 1) for Mon–Sun, then load again.
              </p>
            )}
          </Card>

          {modalEmployee && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
              onClick={closeModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="deduction-modal-title"
            >
              <div
                className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-800"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="deduction-modal-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                  Tardiness & manual deduction — {modalEmployee.employeeName}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Tardiness: 0–5 min → 0%; &gt;5–10 min → 15%; &gt;10 min → 20%. Reason required if manual deduction &gt; 0.
                </p>
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Weekly tardiness (minutes)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={editTardiness}
                      onChange={(e) => setEditTardiness(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
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
                  <Button onClick={handleSaveDeductions} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
