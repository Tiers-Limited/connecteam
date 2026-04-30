import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import {
  getWeeklyPayout,
  upsertTardiness,
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
import { FiCreditCard, FiLoader, FiZap } from "react-icons/fi";
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

function formatTardinessDate(value) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const dt = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString("en-CA", {
    month: "short",
    day: "2-digit",
  });
}

export default function WeeklyPayout({ embedded = false, stepTitle = null }) {
  const { selectedLocationId, setSelectedLocationId, locations } = useApp();
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [modalEmployee, setModalEmployee] = useState(null);
  const [editTardinessByDate, setEditTardinessByDate] = useState({});
  const [editManualAmount, setEditManualAmount] = useState("");
  const [editAdditionalTips, setEditAdditionalTips] = useState("");
  const [editManualReason, setEditManualReason] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const progressTimerRef = useRef(null);
  const progressResetRef = useRef(null);

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

  const openDeductionModal = useCallback((p) => {
      setModalEmployee(p);
      const byDate = {};
      let byDateTotal = 0;
      let firstDateKey = "";
      (p.dailyBreakdown || []).forEach((d) => {
        const dateKey = String(d?.date || "").slice(0, 10);
        const mins = Number(d?.tardinessMinutes) || 0;
        if (dateKey && mins > 0) {
          byDate[dateKey] = String(mins);
          byDateTotal += mins;
          if (!firstDateKey) firstDateKey = dateKey;
        }
      });
      const savedWeekly = Math.max(0, Number(p?.weeklyTardinessMinutes) || 0);
      if (savedWeekly !== byDateTotal && firstDateKey) {
        const adjusted = {};
        Object.keys(byDate).forEach((k) => {
          adjusted[k] = "0";
        });
        adjusted[firstDateKey] = String(savedWeekly);
        setEditTardinessByDate(adjusted);
      } else {
        setEditTardinessByDate(byDate);
      }
      setEditManualAmount(String(Math.max(0, Number(p.manualDeduction) || 0)));
      setEditAdditionalTips(String(Math.max(0, Number(p.additionalTips) || 0)));
      setEditManualReason(String(p.manualDeductionReason || "").trim());
    }, []);

  const closeModal = useCallback(() => {
    setModalEmployee(null);
  }, []);

  const modalLateDays =
    modalEmployee?.dailyBreakdown
      ?.filter((d) => (Number(d?.tardinessMinutes) || 0) > 0)
      .sort((a, b) =>
        String(a?.date || "").slice(0, 10).localeCompare(String(b?.date || "").slice(0, 10)),
      )
      .map((d) => {
        const dateKey = String(d?.date || "").slice(0, 10);
        return {
          dateKey,
          dateLabel: formatTardinessDate(d?.date),
          minutes: Number(d?.tardinessMinutes) || 0,
        };
      }) ?? [];

  const computedWeeklyTardiness = modalLateDays.reduce((sum, day) => {
    const raw = editTardinessByDate?.[day.dateKey];
    const mins = Math.max(0, Number(raw) || 0);
    return sum + mins;
  }, 0);

  const handleSaveDeductions = useCallback(async () => {
    if (!modalEmployee || !selectedLocationId) return;
    for (const day of modalLateDays) {
      const val = editTardinessByDate?.[day.dateKey];
      if (val == null || val === "") continue;
      const mins = Number(val);
      if (!Number.isFinite(mins) || mins < 0) {
        toast.error(`Invalid tardiness minutes for ${day.dateLabel}.`);
        return;
      }
    }
    const deductionAmt = parseFloat(editManualAmount) || 0;
    const additionalTipsAmt = parseFloat(editAdditionalTips) || 0;
    const reason = editManualReason.trim();
    if (deductionAmt < 0 || additionalTipsAmt < 0) {
      toast.error("Manual deduction and additional tips must be 0 or more.");
      return;
    }
    if ((deductionAmt > 0 || additionalTipsAmt > 0) && !reason) {
      toast.error("Reason is required when manual adjustment is not zero.");
      return;
    }
    setSaving(true);
    try {
      await upsertTardiness({
        employeeId: modalEmployee.employeeId,
        locationId: selectedLocationId,
        weekStart: startDate.trim().slice(0, 10),
        weekEnd: endDate.trim().slice(0, 10),
        totalTardinessMinutes: computedWeeklyTardiness,
      });
      await upsertManualDeduction({
        employeeId: modalEmployee.employeeId,
        locationId: selectedLocationId,
        weekStart: startDate.trim().slice(0, 10),
        amount: deductionAmt,
        additionalTips: additionalTipsAmt,
        reason: deductionAmt !== 0 || additionalTipsAmt !== 0 ? reason : "",
      });
      toast.success(`Saved for ${modalEmployee.employeeName}`);
      closeModal();
      loadPayout(true);
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
    editTardinessByDate,
    modalLateDays,
    computedWeeklyTardiness,
    editManualAmount,
    editAdditionalTips,
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

  const payoutBusy = loading || saving;
  useEffect(() => {
    if (payoutBusy) {
      if (progressResetRef.current) {
        clearTimeout(progressResetRef.current);
        progressResetRef.current = null;
      }
      setProgressPercent((prev) => (prev > 8 ? prev : 8));
      if (!progressTimerRef.current) {
        progressTimerRef.current = setInterval(() => {
          setProgressPercent((prev) => {
            if (prev >= 92) return prev;
            if (prev < 40) return Math.min(92, prev + 6);
            if (prev < 70) return Math.min(92, prev + 3);
            return Math.min(92, prev + 1);
          });
        }, 220);
      }
      return;
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (progressPercent > 0) {
      setProgressPercent(100);
      progressResetRef.current = setTimeout(() => {
        setProgressPercent(0);
        progressResetRef.current = null;
      }, 420);
    }
  }, [payoutBusy, progressPercent]);

  useEffect(
    () => () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (progressResetRef.current) clearTimeout(progressResetRef.current);
    },
    [],
  );

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
  const modalRoot = typeof document !== "undefined" ? document.body : null;
  if (!selectedLocationId) {
    return (
      <div className="space-y-6">
        {!embedded && (
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{pageTitle}</h1>
        )}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-white/[0.03] p-6 shadow-sm backdrop-blur-sm">
          <p className="text-slate-600 dark:text-slate-300">
            Select a location to view weekly payout.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {!embedded && <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{pageTitle}</h1>}
          {!embedded && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Phase 2: Weekly aggregation → Tardiness deduction → Weekly after
              tardiness
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Location
            </label>
            <select
              value={selectedLocationId || ""}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="dark-select rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 shadow-sm dark:[color-scheme:dark] focus:border-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
            >
              {locations.map((loc) => (
                <option key={loc._id} value={loc._id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
              From date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 shadow-sm dark:[color-scheme:dark] focus:border-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
              To date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 shadow-sm dark:[color-scheme:dark] focus:border-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
            />
          </div>
          <Button onClick={() => loadPayout(false)} disabled={loading}>
            {loading ? "Loading..." : "Load payout"}
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
      {!embedded && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 border-l-4 border-l-indigo-400 bg-white/90 dark:bg-white/[0.03] p-5 shadow-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {locationName} — {displayRangeStart} – {displayRangeEnd}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Select <strong className="text-slate-900 dark:text-slate-100">From date</strong> and{" "}
                <strong className="text-slate-900 dark:text-slate-100">To date</strong>, then click{" "}
                <strong className="text-slate-900 dark:text-slate-100">Load payout</strong>. Tardiness
                and working hours are pulled from Connecteam for the selected
                range (working hours are net after manual breaks). Weekly Gross Tips = Σ Daily Tips in range. Tardiness: 0–5
                min → 0%; &gt;5–10 min → 15%; &gt;10 min → 20%. Redistribution by{" "}
                <strong className="text-slate-900 dark:text-slate-100">total working hours</strong>{" "}
                from Connecteam.
              </p>
            </div>
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-white/[0.03] p-8 text-center shadow-sm backdrop-blur-sm">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-300/30 dark:bg-indigo-500/10 dark:text-indigo-300">
              <FiCreditCard className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No payout data loaded
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Select a location and date range, then click{" "}
              <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                Load payout
              </span>
              .
            </p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Main table card */}
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-white/[0.03] shadow-sm backdrop-blur-sm">
            <div className="border-b border-slate-200 dark:border-white/10 px-6 pb-4 pt-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Weekly Staff Payout Table
              </h2>
            </div>

            <div className="px-6 py-4">
              {totalRows > 0 &&
                (data.redistributionPool != null ||
                  data.eligibleTotalHours != null) && (
                  <div className="mb-4 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-4 py-3 text-sm">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      Tardiness Redistribution (Staff Tips)
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      Redistribution pool:{" "}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {formatMoney(data.redistributionPool ?? 0)}
                      </strong>
                    </p>
                  </div>
                )}

              {data && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-white/10 pb-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {totalRows > 0 && (
                      <>
                        <span className="text-sm text-slate-600 dark:text-slate-300">
                          {totalRows} employee{totalRows !== 1 ? "s" : ""}
                        </span>
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          Rows per page
                          <select
                            value={pageSize}
                            onChange={(e) => {
                              setPageSize(Number(e.target.value));
                              setPage(1);
                            }}
                            className="dark-select rounded border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
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
                        className="rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-1.5 text-slate-700 dark:text-slate-200 transition hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <span className="min-w-[100px] text-center text-slate-600 dark:text-slate-300">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={currentPage >= totalPages}
                        className="rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-1.5 text-slate-700 dark:text-slate-200 transition hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="relative z-0 max-h-[75vh] overflow-auto pr-4 pb-4 [scrollbar-color:rgba(99,102,241,0.55)_#e2e8f0] dark:[scrollbar-color:rgba(99,102,241,0.55)_rgba(15,23,42,0.7)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200 dark:[&::-webkit-scrollbar-track]:bg-slate-900/70 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-indigo-400/60 [&::-webkit-scrollbar-thumb:hover]:bg-indigo-300/70">
                <table className="w-full min-w-[1200px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10">
                      <th className="sticky left-0 top-0 z-[3] w-20 min-w-[5rem] max-w-[5rem] whitespace-nowrap bg-white dark:bg-slate-900 px-2 pb-3 pt-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Action
                      </th>
                      <th className="sticky left-20 top-0 z-[2] whitespace-nowrap bg-white dark:bg-slate-900 px-4 pb-3 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Employee
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Location
                      </th>
                      {weekDateColumns.map((col) => (
                        <th
                          key={col.dateKey}
                          className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-2 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                          title={`Tips for ${col.label}`}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                        title="Σ Daily Tips (Mon–Sun), basis for deductions"
                      >
                        Weekly Gross Tips
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                        title="Total working hours for the week (from Weekly Tardiness / Connecteam); used for redistribution"
                      >
                        Working hours
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                        title="Manual break time from Connecteam for the range"
                      >
                        Break hours
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Weekly Tardiness (min)
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Tardiness %
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Tardiness Deduction
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Weekly After Tardiness
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Manual Deduction
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Additional Tips (+)
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Net Weekly Tips
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pr-4 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                        title="Tips received from others (eligible: ≤5 min tardiness, worked hours > 0)"
                      >
                        Tardiness Redistribution
                      </th>
                      <th
                        className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pl-4 pr-6 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                        title="Net tips + redistribution"
                      >
                        Final Weekly Tips Payable
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                    {paginatedPayouts.map((p) => (
                      <tr
                        key={p.employeeId}
                        className="transition-colors hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
                      >
                        <td className="sticky left-0 z-[2] w-20 min-w-[5rem] max-w-[5rem] bg-white dark:bg-slate-900 py-3 pr-2 text-center">
                          <button
                            type="button"
                            onClick={() => openDeductionModal(p)}
                            className="rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm transition hover:border-indigo-300/50 hover:bg-indigo-100 hover:text-indigo-700 dark:hover:border-indigo-300/30 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-100"
                            title="Tardiness & manual deduction"
                          >
                            Edit
                          </button>
                        </td>
                        <td className="sticky left-20 z-[1] bg-white dark:bg-slate-900 px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                          {p.employeeName}
                        </td>
                        <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                          {locationName}
                        </td>
                        {weekDateColumns.map((col, idx) => (
                          <td
                            key={col.dateKey}
                            className="py-3 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300"
                          >
                            {formatMoney((p.dailyTipsByDay || [])[idx] ?? 0)}
                          </td>
                        ))}
                        <td
                          className="py-3 pr-4 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100"
                          title="Sum of Mon–Sun"
                        >
                          {formatMoney(
                            p.weeklyGrossTips ?? p.dailyTipsMonToSun,
                          )}
                        </td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300"
                          title="From Weekly Tardiness (Connecteam); used for redistribution"
                        >
                          {formatDurationHours(p.totalWorkingMinutes)}
                        </td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300"
                          title="Manual break time from Connecteam"
                        >
                          {formatDurationHours(breakMinutesFromRow(p))}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {p.weeklyTardinessMinutes ?? 0}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {p.tardinessPercent ?? 0}%
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-amber-700 dark:text-amber-300">
                          {formatMoney(p.tardinessDeduction)}
                        </td>
                        <td className="py-3 pr-4 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoney(p.weeklyAfterTardiness)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {formatMoney(p.manualDeduction)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                          {formatMoney(p.additionalTips ?? 0)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {formatMoney(p.netWeeklyTips)}
                        </td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums text-emerald-700 dark:text-emerald-300"
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
                        <td className="py-3 pl-4 pr-6 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoney(p.finalWeeklyTipsPayable ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalRows === 0 && (
                <div className="py-10 text-center text-slate-600 dark:text-slate-300">
                  {data?.emptyReason === "no_employees_for_location" ? (
                    <>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
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
          {modalEmployee &&
            modalRoot &&
            createPortal(
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
                onClick={closeModal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="deduction-modal-title"
              >
              <div
                className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/90 p-6 shadow-xl backdrop-blur-md"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="deduction-modal-title"
                  className="text-lg font-semibold text-slate-900 dark:text-slate-100"
                >
                  Tardiness & manual deduction — {modalEmployee.employeeName}
                </h2>
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Late days in selected range
                    </label>
                    {modalLateDays.length > 0 ? (
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 p-3">
                        <div
                          className="grid gap-2"
                          style={{
                            gridTemplateColumns: `repeat(${modalLateDays.length}, minmax(80px, 1fr))`,
                          }}
                        >
                          {modalLateDays.map((day) => (
                            <div
                              key={`head-${day.dateKey}`}
                              className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                            >
                              {day.dateLabel}
                            </div>
                          ))}
                          {modalLateDays.map((day) => (
                            <input
                              key={`value-${day.dateKey}`}
                              type="number"
                              min="0"
                              step="1"
                              value={editTardinessByDate?.[day.dateKey] ?? String(day.minutes)}
                              onChange={(e) =>
                                setEditTardinessByDate((prev) => ({
                                  ...prev,
                                  [day.dateKey]: e.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-slate-800 px-2 py-1.5 text-center text-sm tabular-nums text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:border-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                        No late dates in this selected range.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Weekly tardiness (minutes)
                    </label>
                    <p className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">
                      {computedWeeklyTardiness} min
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Auto-calculated from the editable late-day rows above.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Manual deduction ($)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editManualAmount}
                      onChange={(e) => setEditManualAmount(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:border-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Additional tips (+$)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editAdditionalTips}
                      onChange={(e) => setEditAdditionalTips(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:border-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Adds tips only to this employee. Net manual adjustment =
                      deduction - additional tips.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Reason{" "}
                      <span className="text-slate-500 dark:text-slate-400">
                        (required if amount &gt; 0)
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Uniform, equipment"
                      value={editManualReason}
                      onChange={(e) => setEditManualReason(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/25"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <Button onClick={handleSaveDeductions} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
              </div>,
              modalRoot,
            )}

          {progressPercent > 0 &&
            modalRoot &&
            createPortal(
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center p-6"
                role="dialog"
                aria-modal="true"
                aria-labelledby="weekly-payout-busy-title"
                aria-busy="true"
                aria-live="polite"
              >
                <div
                  className="absolute inset-0 bg-gradient-to-br from-slate-950/75 via-indigo-950/50 to-slate-950/75 backdrop-blur-md"
                  aria-hidden
                />
                <div className="relative w-full max-w-md animate-[fadeIn_0.35s_ease-out] overflow-hidden rounded-3xl border border-white/15 bg-white/98 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_25px_50px_-12px_rgba(15,23,42,0.45),0_0_80px_-20px_rgba(99,102,241,0.35)] dark:border-white/10 dark:bg-slate-900/98 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_25px_50px_-12px_rgba(0,0,0,0.65),0_0_90px_-24px_rgba(99,102,241,0.45)]">
                  <div
                    className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400 bg-[length:200%_100%] animate-[shimmer_2.2s_linear_infinite]"
                    aria-hidden
                  />
                  <div className="px-8 pb-10 pt-9 text-center sm:px-10">
                    <div className="relative mx-auto mb-7 flex h-[7.25rem] w-[7.25rem] flex-col items-center justify-center">
                      <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-violet-500/25 via-indigo-400/20 to-cyan-400/25 blur-xl" aria-hidden />
                      <div className="pointer-events-none absolute inset-1 rounded-full border-2 border-dashed border-indigo-400/35 dark:border-indigo-400/25" aria-hidden />
                      <div className="relative flex flex-col items-center justify-center gap-1.5">
                        <div className="relative flex items-center justify-center">
                          <FiZap className="absolute -right-1 -top-1 h-5 w-5 text-cyan-400 motion-safe:animate-pulse sm:h-6 sm:w-6" aria-hidden />
                          <FiLoader
                            className="h-12 w-12 text-indigo-600 drop-shadow-[0_0_10px_rgba(99,102,241,0.45)] motion-safe:animate-spin dark:text-indigo-400 sm:h-14 sm:w-14"
                            style={{ animationDuration: "1.05s" }}
                            aria-hidden
                          />
                        </div>
                        <span className="text-[1.65rem] font-bold tabular-nums tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                          {Math.round(progressPercent)}
                          <span className="text-lg font-semibold text-indigo-500 dark:text-indigo-300 sm:text-xl">%</span>
                        </span>
                      </div>
                    </div>
                    <h2 id="weekly-payout-busy-title" className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                      {saving ? "Saving & recalculating payout" : "Loading payout"}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      Fetching and calculating weekly payout details for this location.
                    </p>
                    <div className="mt-8 h-2.5 w-full overflow-hidden rounded-full bg-slate-200/90 ring-1 ring-slate-900/5 dark:bg-white/[0.08] dark:ring-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400 shadow-[0_0_14px_rgba(99,102,241,0.55)] transition-[width] duration-200 ease-out"
                        style={{ width: `${Math.min(100, progressPercent)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <style>{`
                  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
                  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
                `}</style>
              </div>,
              modalRoot,
            )}
        </>
      )}
    </div>
  );
}



