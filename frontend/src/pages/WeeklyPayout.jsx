import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import {
  getWeeklyPayout,
  getManualDeductions,
  upsertManualDeduction,
} from '../services/weeklyPayoutService';
import { getWeekStart, getWeekEnd, toLocalDateString, formatWeekRange, getWeekDateColumns, getDateRangeColumns } from '../utils/dateUtils';
import { exportTableToCSV, exportTableToPDF } from '../utils/reportUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

const PAGE_SIZES = [10, 25, 50, 100];

function formatMoney(n) {
  return '$' + (Number(n) ?? 0).toFixed(2);
}

function getDefaultDateRange() {
  const mon = getWeekStart(new Date());
  const sun = getWeekEnd(mon);
  return { start: toLocalDateString(mon), end: toLocalDateString(sun) };
}

export default function WeeklyPayout() {
  const { selectedLocationId, setSelectedLocationId, locations } = useApp();
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualEdits, setManualEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [modalEmployee, setModalEmployee] = useState(null);
  const [editManualAmount, setEditManualAmount] = useState('');
  const [editManualReason, setEditManualReason] = useState('');

  const loadPayout = useCallback((refresh = false) => {
    if (!selectedLocationId) {
      toast.error('Select a location first');
      return;
    }
    const start = startDate.trim().slice(0, 10);
    const end = endDate.trim().slice(0, 10);
    if (!start || !end || new Date(end + 'T12:00:00') < new Date(start + 'T12:00:00')) {
      toast.error('Please select a valid date range (From ≤ To).');
      return;
    }
    setLoading(true);
    getWeeklyPayout(selectedLocationId, start, refresh, start, end)
      .then((res) => {
        const payload = res && typeof res === 'object' ? res : null;
        const count = Array.isArray(payload?.payouts) ? payload.payouts.length : 0;
        const emptyReason = payload?.emptyReason;
        console.log('[WeeklyPayout] Tip/payout data from API:', {
          locationId: selectedLocationId,
          dateRange: { start, end },
          refresh,
          payoutsCount: count,
          emptyReason: emptyReason ?? null,
          payload: payload ?? null,
        });
        setData(payload);
        setPage(1);
        if (count === 0 && emptyReason === 'no_employees_for_location') {
          toast.success('Loaded. No employees for this location—see message below.');
        } else {
          toast.success(
            refresh
              ? `Recalculated and saved payout for ${count} employees.`
              : `Loaded payout for ${count} employees.`
          );
        }
      })
      .catch((err) => {
        setData(null);
        const msg = err.response?.data?.error || err.message || 'Failed to load payout';
        console.error('[WeeklyPayout] Load payout failed:', { locationId: selectedLocationId, weekStart, error: msg, response: err.response?.data });
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId, startDate, endDate]);

  const openDeductionModal = useCallback((p) => {
    setModalEmployee(p);
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
      await upsertManualDeduction({
        employeeId: modalEmployee.employeeId,
        locationId: selectedLocationId,
        weekStart: startDate.trim().slice(0, 10),
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
  }, [modalEmployee, selectedLocationId, startDate, editManualAmount, editManualReason, closeModal, loadPayout]);

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
    const m = {};
    data.payouts.forEach((p) => {
      m[p.employeeId] = { amount: String(p.manualDeduction ?? 0), reason: '' };
    });
    setManualEdits(m);
    const weekKey = (data?.dateRange?.startDate || startDate).trim().slice(0, 10);
    getManualDeductions(selectedLocationId, weekKey)
      .then((list) => {
        const next = { ...m };
        list.forEach((r) => {
          const id = r.employeeId?._id || r.employeeId;
          if (id) next[id] = { amount: String(r.amount ?? 0), reason: r.reason || '' };
        });
        setManualEdits(next);
      })
      .catch(() => {});
  }, [selectedLocationId, startDate, data?.payouts, data?.dateRange]);

  const location = locations.find((l) => l._id === selectedLocationId);
  const payouts = data?.payouts ?? [];
  const locationName = data?.locationName ?? location?.name ?? '—';
  // Display header uses current form selection so From/To changes update the shown range
  const displayRangeStart = startDate.trim().slice(0, 10);
  const displayRangeEnd = endDate.trim().slice(0, 10);
  // Table columns use loaded data range when available so columns match API response
  const rangeStart = data?.dateRange?.startDate ?? startDate;
  const rangeEnd = data?.dateRange?.endDate ?? endDate;
  const weekDateColumns = data?.dateRange
    ? getDateRangeColumns(rangeStart, rangeEnd)
    : getWeekDateColumns(startDate);
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

  const spinner = (
    <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );

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
          <Button onClick={() => loadPayout(false)} disabled={loading}>
            {loading ? (
              <>
                {spinner}
                Loading…
              </>
            ) : (
              'Load payout'
            )}
          </Button>
          <Button
            onClick={() => loadPayout(true)}
            disabled={loading}
            variant="secondary"
          >
            Recalculate
          </Button>
        </div>
      </div>

      <Card className="border-l-4 border-l-indigo-500 bg-slate-50 dark:bg-slate-800/50">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {locationName} — {displayRangeStart} – {displayRangeEnd}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Select <strong>From date</strong> and <strong>To date</strong>, then click <strong>Load payout</strong>. Tardiness and working hours are pulled from ConnectTeam for the selected range. Weekly Gross Tips = Σ Daily Tips in range. Tardiness: 0–5 min → 0%; &gt;5–10 min → 15%; &gt;10 min → 20%. Redistribution by <strong>total working hours</strong> from ConnectTeam.
            </p>
          </div>
        </div>
      </Card>

      {!data && !loading && (
        <Card>
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">
            Select location and date range (From and To), then click <strong>Load payout</strong> to fetch data from ConnectTeam for that range. Ensure daily tips are entered for the days in range (Phase 1).
          </p>
        </Card>
      )}

      {data && (
        <>
          <Card title="Weekly Staff Payout Table">
            {totalRows > 0 && (data.redistributionPool != null || data.eligibleTotalHours != null) && (
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                <p className="font-medium text-slate-700 dark:text-slate-300">Tardiness Redistribution (Staff Tips)</p>
                <p className="mt-1 text-slate-600 dark:text-slate-400">
                  Redistribution pool: <strong>{formatMoney(data.redistributionPool ?? 0)}</strong> (Σ tardiness deductions). Distributed to eligible staff (weekly tardiness ≤5 min, total working hours &gt; 0) by proportion of <strong>total working hours</strong> from Weekly Tardiness (Connecteam). Employees with a tardiness deduction receive $0.00 redistribution.
                </p>
              </div>
            )}
            {totalRows > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-3">
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
                  <div className="flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-600">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Report:</span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const headers = [
                          'Employee', 'Location',
                          ...weekDateColumns.map((c) => c.label),
                          'Weekly Gross Tips', 'Working hours', 'Weekly Tardiness (min)', 'Tardiness %',
                          'Tardiness Deduction', 'Weekly After Tardiness', 'Manual Deduction', 'Net Weekly Tips',
                          'Tardiness Redistribution', 'Final Weekly Tips Payable',
                        ];
                        const rows = payouts.map((p) => {
                          const wh = p.totalWorkingMinutes ?? 0;
                          const whStr = wh <= 0 ? '–' : `${Math.floor(wh / 60)}h${wh % 60 ? ` ${wh % 60}m` : ''}`;
                          return [
                            p.employeeName ?? '',
                            locationName,
                            ...(weekDateColumns.map((col, idx) => formatMoney((p.dailyTipsByDay || [])[idx] ?? 0))),
                            formatMoney(p.weeklyGrossTips ?? p.dailyTipsMonToSun),
                            whStr,
                            String(p.weeklyTardinessMinutes ?? 0),
                            `${p.tardinessPercent ?? 0}%`,
                            formatMoney(p.tardinessDeduction),
                            formatMoney(p.weeklyAfterTardiness),
                            formatMoney(p.manualDeduction),
                            formatMoney(p.netWeeklyTips),
                            formatMoney(p.tardinessRedistribution ?? 0),
                            formatMoney(p.finalWeeklyTipsPayable ?? 0),
                          ];
                        });
                        exportTableToCSV(headers, rows, `weekly-payout-${displayRangeStart}-${displayRangeEnd}.csv`);
                      }}
                    >
                      Export CSV
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const headers = [
                          'Employee', 'Location',
                          ...weekDateColumns.map((c) => c.label),
                          'Weekly Gross Tips', 'Working hours', 'Weekly Tardiness (min)', 'Tardiness %',
                          'Tardiness Deduction', 'Weekly After Tardiness', 'Manual Deduction', 'Net Weekly Tips',
                          'Tardiness Redistribution', 'Final Weekly Tips Payable',
                        ];
                        const rows = payouts.map((p) => {
                          const wh = p.totalWorkingMinutes ?? 0;
                          const whStr = wh <= 0 ? '–' : `${Math.floor(wh / 60)}h${wh % 60 ? ` ${wh % 60}m` : ''}`;
                          return [
                            p.employeeName ?? '',
                            locationName,
                            ...(weekDateColumns.map((col, idx) => formatMoney((p.dailyTipsByDay || [])[idx] ?? 0))),
                            formatMoney(p.weeklyGrossTips ?? p.dailyTipsMonToSun),
                            whStr,
                            String(p.weeklyTardinessMinutes ?? 0),
                            `${p.tardinessPercent ?? 0}%`,
                            formatMoney(p.tardinessDeduction),
                            formatMoney(p.weeklyAfterTardiness),
                            formatMoney(p.manualDeduction),
                            formatMoney(p.netWeeklyTips),
                            formatMoney(p.tardinessRedistribution ?? 0),
                            formatMoney(p.finalWeeklyTipsPayable ?? 0),
                          ];
                        });
                        exportTableToPDF(`Weekly Payout — ${locationName} — ${displayRangeStart} – ${displayRangeEnd}`, headers, rows, `weekly-payout-${displayRangeStart}-${displayRangeEnd}.pdf`);
                      }}
                    >
                      Export PDF
                    </Button>
                  </div>
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
                    {weekDateColumns.map((col) => (
                      <th
                        key={col.dateKey}
                        className="whitespace-nowrap pb-3 pr-2 text-right font-semibold text-slate-700 dark:text-slate-300"
                        title={`Tips for ${col.label}`}
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300" title="Σ Daily Tips (Mon–Sun), basis for deductions">
                      Weekly Gross Tips
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300" title="Total working hours for the week (from Weekly Tardiness / Connecteam); used for redistribution">
                      Working hours
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
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300" title="Tips received from others (eligible: ≤5 min tardiness, worked hours &gt; 0)">
                      Tardiness Redistribution
                    </th>
                    <th className="whitespace-nowrap pb-3 pl-4 text-right font-semibold text-slate-700 dark:text-slate-300" title="Net tips + redistribution">
                      Final Weekly Tips Payable
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
                      {weekDateColumns.map((col, idx) => (
                        <td key={col.dateKey} className="py-3 pr-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {formatMoney((p.dailyTipsByDay || [])[idx] ?? 0)}
                        </td>
                      ))}
                      <td className="py-3 pr-4 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200" title="Sum of Mon–Sun">
                        {formatMoney(p.weeklyGrossTips ?? p.dailyTipsMonToSun)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-700 dark:text-slate-300" title="From Weekly Tardiness (Connecteam); used for redistribution">
                        {(() => {
                          const mins = p.totalWorkingMinutes ?? 0;
                          if (mins <= 0) return '–';
                          const h = Math.floor(mins / 60);
                          const m = mins % 60;
                          return `${h}h${m ? ` ${m}m` : ''}`;
                        })()}
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
                      <td className="py-3 pr-4 text-right tabular-nums text-emerald-600 dark:text-emerald-400" title={((p.weeklyTardinessMinutes ?? 0) > 5 ? 'Not eligible (tardiness deduction applied)' : (p.totalWorkingMinutes ?? 0) <= 0 ? 'Not eligible (no working hours from Weekly Tardiness)' : 'Tips received from redistribution pool by share of working hours')}>
                        {formatMoney(p.tardinessRedistribution ?? 0)}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(p.finalWeeklyTipsPayable ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalRows === 0 && (
              <div className="py-8 text-center text-slate-600 dark:text-slate-400">
                {data?.emptyReason === 'no_employees_for_location' ? (
                  <>
                    <p className="font-medium text-slate-700 dark:text-slate-300">No employees found for this location.</p>
                    <p className="mt-2 text-sm">
                      Load payout uses Daily Tips and Weekly Tardiness from the DB (no Time Entries page needed). First: (1) Weekly Tardiness → select this location and week → Load from Connecteam (creates employees), (2) Daily Tips → enter AM/PM gross tips for each day and Save. Then click Load payout again. Check backend console for debug logs.
                    </p>
                  </>
                ) : (
                  <p>
                    No payout data for this week. Enter daily tips (Phase 1) for Mon–Sun, then load again.
                  </p>
                )}
              </div>
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
                  Tardiness comes from the Weekly Tardiness page (load there first). Reason required if manual deduction &gt; 0.
                </p>
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Weekly tardiness (minutes)
                    </label>
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {modalEmployee.weeklyTardinessMinutes ?? 0} min (from Weekly Tardiness)
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
