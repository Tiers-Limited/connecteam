import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import {
  getWeeklyPayout,
  getManualDeductions,
  upsertManualDeduction,
} from "../services/weeklyPayoutService";
import {
  getWeekStart,
  getWeekEnd,
  toLocalDateString,
  formatWeekRange,
  getWeekDateColumns,
  getDateRangeColumns,
  columnsFromDayDateKeys,
} from "../utils/dateUtils";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";

const PAGE_SIZES = [10, 25, 50, 100];

function formatMoney(n) {
  return "$" + (Number(n) ?? 0).toFixed(2);
}

function getDefaultDateRange() {
  const mon = getWeekStart(new Date());
  const sun = getWeekEnd(mon);
  return { start: toLocalDateString(mon), end: toLocalDateString(sun) };
}

function formatDurationHours(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  if (mins <= 0) return "0h (0.00h)";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const decimal = (mins / 60).toFixed(2);
  return `${h}h${m ? ` ${m}m` : ""} (${decimal}h)`;
}

function breakMinutesFromRow(row) {
  const direct = Number(row?.totalBreakMinutes);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  if (Array.isArray(row?.dailyBreakdown)) {
    return row.dailyBreakdown.reduce(
      (sum, d) => sum + (Number(d?.breakMinutes) || 0),
      0,
    );
  }
  return 0;
}

export default function WeeklyPayout({ embedded = false, stepTitle = null }) {
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
  const [editManualAmount, setEditManualAmount] = useState("");
  const [editManualReason, setEditManualReason] = useState("");

  const loadPayout = useCallback(
    (refresh = false) => {
      if (!selectedLocationId) {
        toast.error("Select a location first");
        return;
      }
      const start = startDate.trim().slice(0, 10);
      const end = endDate.trim().slice(0, 10);
      if (
        !start ||
        !end ||
        new Date(end + "T12:00:00") < new Date(start + "T12:00:00")
      ) {
        toast.error("Please select a valid date range (From ≤ To).");
        return;
      }
      setLoading(true);
      getWeeklyPayout(selectedLocationId, start, refresh, start, end)
        .then((res) => {
          const payload = res && typeof res === "object" ? res : null;
          const count = Array.isArray(payload?.payouts)
            ? payload.payouts.length
            : 0;
          const emptyReason = payload?.emptyReason;
          console.log("[WeeklyPayout] Tip/payout data from API:", {
            locationId: selectedLocationId,
            dateRange: { start, end },
            refresh,
            payoutsCount: count,
            emptyReason: emptyReason ?? null,
            payload: payload ?? null,
          });
          setData(payload);
          setPage(1);
          if (count === 0 && emptyReason === "no_employees_for_location") {
            toast.success(
              "Loaded. No employees for this location—see message below.",
            );
          } else {
            toast.success(
              refresh
                ? `Recalculated and saved payout for ${count} employees.`
                : `Loaded payout for ${count} employees.`,
            );
          }
        })
        .catch((err) => {
          setData(null);
          const msg =
            err.response?.data?.error || err.message || "Failed to load payout";
          console.error("[WeeklyPayout] Load payout failed:", {
            locationId: selectedLocationId,
            dateRange: { start: startDate.trim().slice(0, 10), end: endDate.trim().slice(0, 10) },
            error: msg,
            response: err.response?.data,
          });
          toast.error(msg);
        })
        .finally(() => setLoading(false));
    },
    [selectedLocationId, startDate, endDate],
  );

  const openDeductionModal = useCallback(
    (p) => {
      setModalEmployee(p);
      setEditManualAmount(String(p.manualDeduction ?? 0));
      setEditManualReason(manualEdits[p.employeeId]?.reason ?? "");
    },
    [manualEdits],
  );

  const closeModal = useCallback(() => {
    setModalEmployee(null);
  }, []);

  const handleSaveDeductions = useCallback(async () => {
    if (!modalEmployee || !selectedLocationId) return;
    const amt = parseFloat(editManualAmount) || 0;
    const reason = editManualReason.trim();
    if (amt > 0 && !reason) {
      toast.error("Reason is required when manual deduction > 0");
      return;
    }
    setSaving(true);
    try {
      await upsertManualDeduction({
        employeeId: modalEmployee.employeeId,
        locationId: selectedLocationId,
        weekStart: startDate.trim().slice(0, 10),
        amount: amt,
        reason: amt > 0 ? reason : "",
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
  }, [
    modalEmployee,
    selectedLocationId,
    startDate,
    editManualAmount,
    editManualReason,
    closeModal,
    loadPayout,
  ]);

  useEffect(() => {
    if (!modalEmployee) return;
    const onEscape = (e) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [modalEmployee, closeModal]);

  useEffect(() => {
    if (!selectedLocationId || !data?.payouts?.length) return;
    const m = {};
    data.payouts.forEach((p) => {
      m[p.employeeId] = { amount: String(p.manualDeduction ?? 0), reason: "" };
    });
    setManualEdits(m);
    const weekKey = (data?.dateRange?.startDate || startDate)
      .trim()
      .slice(0, 10);
    getManualDeductions(selectedLocationId, weekKey)
      .then((list) => {
        const next = { ...m };
        list.forEach((r) => {
          const id = r.employeeId?._id || r.employeeId;
          if (id)
            next[id] = {
              amount: String(r.amount ?? 0),
              reason: r.reason || "",
            };
        });
        setManualEdits(next);
      })
      .catch(() => {});
  }, [selectedLocationId, startDate, data?.payouts, data?.dateRange]);

  const location = locations.find((l) => l._id === selectedLocationId);
  const payouts = [...(data?.payouts ?? [])].sort((a, b) =>
    (a?.employeeName || "").localeCompare(b?.employeeName || "", undefined, {
      sensitivity: "base",
    }),
  );
  const locationName = data?.locationName ?? location?.name ?? "—";
  const displayRangeStart = startDate.trim().slice(0, 10);
  const displayRangeEnd = endDate.trim().slice(0, 10);
  const rangeStart = data?.dateRange?.startDate ?? startDate;
  const rangeEnd = data?.dateRange?.endDate ?? endDate;
  const weekDateColumns = data?.dateRange
    ? Array.isArray(data.dayDateKeys) && data.dayDateKeys.length > 0
      ? columnsFromDayDateKeys(data.dayDateKeys)
      : getDateRangeColumns(rangeStart, rangeEnd)
    : getWeekDateColumns(startDate);
  const totalRows = payouts.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const paginatedPayouts = payouts.slice(start, start + pageSize);
  const pageTitle = stepTitle || "Weekly Staff Payout";

  if (!selectedLocationId) {
    return (
      <div className="space-y-6">
        {!embedded && (
          <h1 className="text-2xl font-bold text-slate-800">{pageTitle}</h1>
        )}
        <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm p-6 shadow-sm">
          <p className="text-slate-500">
            Select a location to view weekly payout.
          </p>
        </div>
      </div>
    );
  }

  const spinner = (
    <svg
      className="mr-2 h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {!embedded && <h1 className="text-2xl font-bold text-slate-800">{pageTitle}</h1>}
          <p className="mt-1 text-sm text-slate-500">
            Phase 2: Weekly aggregation → Tardiness deduction → Weekly after
            tardiness
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">
              Location
            </label>
            <select
              value={selectedLocationId || ""}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {locations.map((loc) => (
                <option key={loc._id} value={loc._id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">
              From date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">
              To date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <Button onClick={() => loadPayout(false)} disabled={loading}>
            {loading ? (
              <>
                {spinner}
                Loading…
              </>
            ) : (
              "Load payout"
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

      {/* Info card */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 backdrop-blur-sm border-l-4 border-l-indigo-400 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-medium text-slate-700">
              {locationName} — {displayRangeStart} – {displayRangeEnd}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Select <strong className="text-slate-600">From date</strong> and{" "}
              <strong className="text-slate-600">To date</strong>, then click{" "}
              <strong className="text-slate-600">Load payout</strong>. Tardiness
              and working hours are pulled from Connecteam for the selected
              range (working hours are net after manual breaks). Weekly Gross Tips = Σ Daily Tips in range. Tardiness: 0–5
              min → 0%; &gt;5–10 min → 15%; &gt;10 min → 20%. Redistribution by{" "}
              <strong className="text-slate-600">total working hours</strong>{" "}
              from Connecteam.
            </p>
          </div>
        </div>
      </div>

      {!data && !loading && (
        <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm p-8 shadow-sm text-center">
          <p className="text-slate-500">
            Select location and date range (From and To), then click{" "}
            <strong className="text-slate-600">Load payout</strong> to fetch
            data from Connecteam for that range. Ensure daily tips are entered
            for the days in range (Phase 1).
          </p>
        </div>
      )}

      {data && (
        <>
          {/* Main table card */}
          <div className="rounded-xl border border-slate-200/70 bg-white/60 backdrop-blur-sm shadow-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-700">
                Weekly Staff Payout Table
              </h2>
            </div>

            <div className="px-6 py-4">
              {totalRows > 0 &&
                (data.redistributionPool != null ||
                  data.eligibleTotalHours != null) && (
                  <div className="mb-4 rounded-lg border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm">
                    <p className="font-medium text-slate-600">
                      Tardiness Redistribution (Staff Tips)
                    </p>
                    <p className="mt-1 text-slate-500">
                      Redistribution pool:{" "}
                      <strong className="text-slate-700">
                        {formatMoney(data.redistributionPool ?? 0)}
                      </strong>{" "}
                      (Σ tardiness deductions). Distributed to eligible staff
                      (weekly tardiness ≤5 min, total working hours &gt; 0) by
                      proportion of{" "}
                      <strong className="text-slate-700">
                        total working hours
                      </strong>{" "}
                      from Weekly Tardiness (Connecteam). Employees with a
                      tardiness deduction receive $0.00 redistribution.
                    </p>
                  </div>
                )}

              {data && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {totalRows > 0 && (
                      <>
                        <span className="text-sm text-slate-500">
                          {totalRows} employee{totalRows !== 1 ? "s" : ""}
                        </span>
                        <label className="flex items-center gap-2 text-sm text-slate-500">
                          Rows per page
                          <select
                            value={pageSize}
                            onChange={(e) => {
                              setPageSize(Number(e.target.value));
                              setPage(1);
                            }}
                            className="rounded border border-slate-200 bg-white/90 px-2 py-1.5 text-sm text-slate-700"
                          >
                            {PAGE_SIZES.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  {totalRows > 0 && (
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
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={currentPage >= totalPages}
                        className="rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="relative z-0 max-h-[75vh] overflow-auto">
                <table className="w-full min-w-[1200px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="sticky left-0 top-0 z-[3] w-20 min-w-[5rem] max-w-[5rem] whitespace-nowrap bg-white pb-3 pr-2 text-center font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Action
                      </th>
                      <th className="sticky left-20 top-0 z-[2] whitespace-nowrap bg-white pb-3 pr-4 text-left font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Employee
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-left font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Location
                      </th>
                      {weekDateColumns.map((col) => (
                        <th
                          key={col.dateKey}
                          className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-2 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide"
                          title={`Tips for ${col.label}`}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide"
                        title="Σ Daily Tips (Mon–Sun), basis for deductions"
                      >
                        Weekly Gross Tips
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide"
                        title="Total working hours for the week (from Weekly Tardiness / Connecteam); used for redistribution"
                      >
                        Working hours
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide"
                        title="Manual break time from Connecteam for the range"
                      >
                        Break hours
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Weekly Tardiness (min)
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Tardiness %
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Tardiness Deduction
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Weekly After Tardiness
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Manual Deduction
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide">
                        Net Weekly Tips
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pr-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide"
                        title="Tips received from others (eligible: ≤5 min tardiness, worked hours > 0)"
                      >
                        Tardiness Redistribution
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white pb-3 pl-4 text-right font-semibold text-slate-500 text-xs uppercase tracking-wide"
                        title="Net tips + redistribution"
                      >
                        Final Weekly Tips Payable
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedPayouts.map((p) => (
                      <tr
                        key={p.employeeId}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="sticky left-0 z-[2] w-20 min-w-[5rem] max-w-[5rem] bg-white py-3 pr-2 text-center">
                          <button
                            type="button"
                            onClick={() => openDeductionModal(p)}
                            className="rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600"
                            title="Tardiness & manual deduction"
                          >
                            Edit
                          </button>
                        </td>
                        <td className="sticky left-20 z-[1] bg-white py-3 pr-4 font-medium text-slate-700">
                          {p.employeeName}
                        </td>
                        <td className="py-3 pr-4 text-slate-500">
                          {locationName}
                        </td>
                        {weekDateColumns.map((col, idx) => (
                          <td
                            key={col.dateKey}
                            className="py-3 pr-2 text-right tabular-nums text-slate-600"
                          >
                            {formatMoney((p.dailyTipsByDay || [])[idx] ?? 0)}
                          </td>
                        ))}
                        <td
                          className="py-3 pr-4 text-right tabular-nums font-medium text-slate-700"
                          title="Sum of Mon–Sun"
                        >
                          {formatMoney(
                            p.weeklyGrossTips ?? p.dailyTipsMonToSun,
                          )}
                        </td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums text-slate-600"
                          title="From Weekly Tardiness (Connecteam); used for redistribution"
                        >
                          {formatDurationHours(p.totalWorkingMinutes)}
                        </td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums text-slate-600"
                          title="Manual break time from Connecteam"
                        >
                          {formatDurationHours(breakMinutesFromRow(p))}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600">
                          {p.weeklyTardinessMinutes ?? 0}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600">
                          {p.tardinessPercent ?? 0}%
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-amber-600">
                          {formatMoney(p.tardinessDeduction)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums font-medium text-slate-700">
                          {formatMoney(p.weeklyAfterTardiness)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600">
                          {formatMoney(p.manualDeduction)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600">
                          {formatMoney(p.netWeeklyTips)}
                        </td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums text-emerald-500"
                          title={
                            (p.weeklyTardinessMinutes ?? 0) > 5
                              ? "Not eligible (tardiness deduction applied)"
                              : (p.totalWorkingMinutes ?? 0) <= 0
                                ? "Not eligible (no working hours from Weekly Tardiness)"
                                : "Tips received from redistribution pool by share of working hours"
                          }
                        >
                          {formatMoney(p.tardinessRedistribution ?? 0)}
                        </td>
                        <td className="py-3 pl-4 text-right tabular-nums font-semibold text-slate-800">
                          {formatMoney(p.finalWeeklyTipsPayable ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalRows === 0 && (
                <div className="py-10 text-center text-slate-500">
                  {data?.emptyReason === "no_employees_for_location" ? (
                    <>
                      <p className="font-medium text-slate-600">
                        No employees found for this location.
                      </p>
                      <p className="mt-2 text-sm">
                        Load payout uses Daily Tips and Weekly Tardiness from
                        the DB (no Time Entries page needed). First: (1) Weekly
                        Tardiness → select this location and week → Load from
                        Connecteam (creates employees), (2) Daily Tips → enter
                        AM/PM gross tips for each day and Save. Then click Load
                        payout again. Check backend console for debug logs.
                      </p>
                    </>
                  ) : (
                    <p>
                      No payout data for this week. Enter daily tips (Phase 1)
                      for Mon–Sun, then load again.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Modal */}
          {modalEmployee && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-800/40 backdrop-blur-sm p-4"
              onClick={closeModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="deduction-modal-title"
            >
              <div
                className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-md p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="deduction-modal-title"
                  className="text-lg font-semibold text-slate-800"
                >
                  Tardiness & manual deduction — {modalEmployee.employeeName}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Tardiness comes from the Weekly Tardiness page (load there
                  first). Reason required if manual deduction &gt; 0.
                </p>
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">
                      Weekly tardiness (minutes)
                    </label>
                    <p className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-600">
                      {modalEmployee.weeklyTardinessMinutes ?? 0} min (from
                      Weekly Tardiness)
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">
                      Manual deduction ($)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editManualAmount}
                      onChange={(e) => setEditManualAmount(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">
                      Reason{" "}
                      <span className="text-slate-400">
                        (required if amount &gt; 0)
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Uniform, equipment"
                      value={editManualReason}
                      onChange={(e) => setEditManualReason(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <Button onClick={handleSaveDeductions} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
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
