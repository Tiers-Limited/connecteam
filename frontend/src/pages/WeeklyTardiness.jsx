import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import { getWeeklyTardiness } from "../services/weeklyTardinessService";
import {
  toLocalDateString,
  getWeekStart,
  getWeekEnd,
  getDateRangeColumns,
  formatDate,
} from "../utils/dateUtils";
import { FiCalendar, FiLoader, FiZap } from "react-icons/fi";
import Button from "../components/ui/Button";

const PAGE_SIZES = [10, 25, 50, 100];

/** Parse "HH:mm" to minutes since midnight for comparison (earliest clock-in = first punch of day) */
function timeToMinutes(str) {
  if (!str || typeof str !== "string") return Infinity;
  const [h, m] = str.trim().split(":").map(Number);
  if (Number.isNaN(h)) return Infinity;
  return (h || 0) * 60 + (Number.isNaN(m) ? 0 : m);
}

function getDefaultDateRange() {
  const mon = getWeekStart(new Date());
  const sun = getWeekEnd(mon);
  return { start: toLocalDateString(mon), end: toLocalDateString(sun) };
}

/** Remove — and – from export so CSV/Excel don't show garbage; replace → with -> */
function sanitizeForExport(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/\u2014/g, "")
    .replace(/\u2013/g, "")
    .replace(/\u2192/g, "->")
    .trim();
}

function formatDurationProfessional(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  if (mins <= 0) return "—";
  const hours = mins / 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const human = `${h}h${m ? ` ${m}m` : ""}`;
  return `${human} (${hours.toFixed(2)}h)`;
}

function getMinutesByEmployee(mapObj, employeeName) {
  const direct = mapObj?.[employeeName];
  if (direct != null) return Number(direct) || 0;
  if (!mapObj || typeof mapObj !== "object") return 0;
  const hit = Object.entries(mapObj).find(
    ([k]) => (k || "").trim() === (employeeName || "").trim(),
  );
  return Number(hit?.[1]) || 0;
}

function toFilenamePart(value, fallback = "all-locations") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export default function WeeklyTardiness({ embedded = false, stepTitle = null }) {
  const { selectedLocationId, setSelectedLocationId, locations } = useApp();
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [progressPercent, setProgressPercent] = useState(0);
  const progressTimerRef = useRef(null);
  const progressResetRef = useRef(null);

  /** Load tardiness for the selected date range from Connecteam. */
  const loadTardiness = useCallback(async () => {
    const start = startDate.trim().slice(0, 10);
    const end = endDate.trim().slice(0, 10);
    if (
      !start ||
      !end ||
      end < start
    ) {
      toast.error("Please select a valid date range (From ≤ To).");
      return;
    }
    setLoading(true);
    setData(null);
    setPage(1);
    try {
      const result = await getWeeklyTardiness(
        start,
        selectedLocationId || undefined,
        false,
        start,
        end,
      );
      setData(result);
      const locLabel = selectedLocationId
        ? locations.find((l) => l._id === selectedLocationId)?.name
        : "All locations";
      toast.success(
        `Loaded ${result?.entries?.length ?? 0} tardiness entries for ${locLabel} (${start} – ${end}).`,
      );
    } catch (err) {
      setData(null);
      const msg =
        err.response?.data?.error || err.message || "Failed to load tardiness";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedLocationId, locations]);

  const location = locations.find((l) => l._id === selectedLocationId);
  const reportLocationPart = toFilenamePart(location?.name);
  const allEntries = data?.entries ?? [];
  const entries =
    selectedLocationId && location
      ? allEntries.filter(
          (e) => (e.locationName || "").trim() === (location.name || "").trim(),
        )
      : allEntries;
  const rangeStart = data?.dateRange?.startDate ?? startDate;
  const rangeEnd = data?.dateRange?.endDate ?? endDate;
  const dateColumns =
    data && rangeStart && rangeEnd
      ? getDateRangeColumns(rangeStart, rangeEnd)
      : [];
  const employeeMap = new Map();
  for (const row of entries) {
    const key = row.employeeName;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, { employeeName: key, byDate: {} });
    }
    const rec = employeeMap.get(key);
    const d = (row.date != null ? String(row.date).trim() : "").slice(0, 10);
    const mins = Math.max(0, Number(row.minutesLate) || 0);
    const clockInMins = timeToMinutes(row.clockIn);
    const locationName = row.locationName || "—";
    if (!rec.byDate[d]) {
      rec.byDate[d] = {
        locationName,
        minutesLate: mins,
        scheduledTime: row.scheduledTime,
        clockIn: row.clockIn,
        _earliestMins: clockInMins,
      };
    } else {
      if (clockInMins < rec.byDate[d]._earliestMins) {
        rec.byDate[d].locationName = locationName;
        rec.byDate[d].scheduledTime = row.scheduledTime;
        rec.byDate[d].clockIn = row.clockIn;
        rec.byDate[d].minutesLate = mins;
        rec.byDate[d]._earliestMins = clockInMins;
      }
    }
  }
  employeeMap.forEach((rec) => {
    Object.keys(rec.byDate || {}).forEach((d) => {
      delete rec.byDate[d]._earliestMins;
    });
  });
  const employeeRows = Array.from(employeeMap.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName),
  );

  if (data && employeeRows.length > 0 && dateColumns.length > 0) {
    employeeRows.forEach((rec) => {
      const byDateKeys = Object.keys(rec.byDate || {});
      const colKeys = dateColumns.map((c) => c.dateKey);
      const match = colKeys.every((ck) => byDateKeys.includes(ck));
    });
  }

  const workingByEmployee = data?.totalWorkingMinutesByEmployee || {};
  const breakByEmployee = data?.totalBreakMinutesByEmployee || {};

  const totalsByDate = {};
  dateColumns.forEach((col) => {
    totalsByDate[col.dateKey] = 0;
  });
  employeeRows.forEach((rec) => {
    Object.entries(rec.byDate || {}).forEach(([dateKey, dayRec]) => {
      const scheduledStr = (dayRec.scheduledTime ?? "").toString().trim();
      const clockInStr = (dayRec.clockIn ?? "").toString().trim();
      const mins =
        scheduledStr && scheduledStr === clockInStr
          ? 0
          : Math.max(0, Number(dayRec.minutesLate) || 0);
      if (totalsByDate[dateKey] !== undefined)
        totalsByDate[dateKey] = (totalsByDate[dateKey] || 0) + mins;
    });
  });
  const rangeTotal = Object.values(totalsByDate).reduce(
    (sum, n) => sum + (n || 0),
    0,
  );

  const totalRows = employeeRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const paginatedRows = employeeRows.slice(start, start + pageSize);
  const pageTitle = stepTitle || "Weekly Tardiness";
  const modalRoot = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    if (loading) {
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
  }, [loading, progressPercent]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (progressResetRef.current) clearTimeout(progressResetRef.current);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {!embedded && <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{pageTitle}</h1>}
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
              <option value="">All locations</option>
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
          <Button onClick={loadTardiness} disabled={loading}>
            {loading ? "Loading..." : "Load from Connecteam"}
          </Button>
        </div>
      </div>

      {!embedded && (
        <p className="text-slate-600 dark:text-slate-300">
          {selectedLocationId && location
            ? `${location.name} — `
            : "All locations — "}
          Select <strong className="text-slate-900 dark:text-slate-100">From date</strong> and{" "}
          <strong className="text-slate-900 dark:text-slate-100">To date</strong>, then click{" "}
          <strong className="text-slate-900 dark:text-slate-100">Load from Connecteam</strong>.
          Tardiness = minutes late (clock-in after scheduled start). Data from
          Connecteam.
        </p>
      )}

      {!data && !loading && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-white/[0.03] p-8 text-center shadow-sm backdrop-blur-sm">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-300/30 dark:bg-indigo-500/10 dark:text-indigo-300">
              <FiCalendar className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No tardiness data loaded
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Choose a date range and click{" "}
              <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                Load from Connecteam
              </span>{" "}
              to fetch records.
            </p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Main tardiness table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-white/[0.03] shadow-sm backdrop-blur-sm">
            <div className="border-b border-slate-200 dark:border-white/10 px-6 pb-4 pt-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Tardiness by employee (minutes late per day)
              </h2>
            </div>
            <div className="px-6 py-4">
              {totalRows > 0 && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-white/10 pb-4">
                  <div className="flex flex-wrap items-center gap-3">
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
                        className="dark-select rounded border border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/5 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
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
                </div>
              )}

              <div className="relative z-0 max-h-[75vh] overflow-auto pr-2 pb-2 [scrollbar-color:rgba(99,102,241,0.55)_#e2e8f0] dark:[scrollbar-color:rgba(99,102,241,0.55)_rgba(15,23,42,0.7)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200 dark:[&::-webkit-scrollbar-track]:bg-slate-900/70 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-indigo-400/60 [&::-webkit-scrollbar-thumb:hover]:bg-indigo-300/70">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10">
                      <th className="sticky left-0 top-0 z-[2] whitespace-nowrap bg-white dark:bg-slate-900 px-4 pb-3 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Employee
                      </th>
                      {dateColumns.map((col) => (
                        <th
                          key={col.dateKey}
                          className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 px-2 pb-3 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pl-2 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Total
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pl-2 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Working hours
                      </th>
                      <th className="sticky top-0 z-[1] whitespace-nowrap bg-white dark:bg-slate-900 pb-3 pl-2 pt-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Break hours
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                    {paginatedRows.map((rec, i) => {
                      const rowTotal = dateColumns.reduce((sum, col) => {
                        const dayRec = rec.byDate[col.dateKey];
                        const raw = dayRec?.minutesLate ?? 0;
                        const s = (dayRec?.scheduledTime ?? "")
                          .toString()
                          .trim();
                        const c = (dayRec?.clockIn ?? "").toString().trim();
                        const mins =
                          s && s === c ? 0 : Math.max(0, Number(raw) || 0);
                        return sum + mins;
                      }, 0);
                      return (
                        <tr
                          key={`${rec.employeeName}-${start + i}`}
                          className="transition-colors hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
                        >
                          <td className="sticky left-0 z-[1] bg-white dark:bg-slate-900 px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                            {rec.employeeName}
                          </td>
                          {dateColumns.map((col) => {
                            const dayRec = rec.byDate[col.dateKey];
                            const rawMinutes = dayRec?.minutesLate;
                            const scheduledStr = (dayRec?.scheduledTime ?? "")
                              .toString()
                              .trim();
                            const clockInStr = (dayRec?.clockIn ?? "")
                              .toString()
                              .trim();
                            const minutes =
                              scheduledStr && scheduledStr === clockInStr
                                ? 0
                                : Math.max(0, Number(rawMinutes) || 0);
                            const isLate = minutes > 0;
                            const dayLocation = dayRec?.locationName ?? "—";
                            return (
                              <td
                                key={col.dateKey}
                                className="py-2.5 px-2 text-right tabular-nums align-top"
                              >
                                <span className="inline-block text-right">
                                  <span className="block font-medium text-slate-600 dark:text-slate-300">
                                    {dayLocation}
                                  </span>
                                  {isLate ? (
                                    <>
                                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                                        {dayRec.scheduledTime ?? "–"} →{" "}
                                        {dayRec.clockIn ?? "–"}
                                      </span>
                                      <span className="font-medium text-amber-300">
                                        {minutes} min
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-slate-600 dark:text-slate-300">–</span>
                                  )}
                                </span>
                              </td>
                            );
                          })}
                          <td className="py-2.5 pl-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                            {rowTotal}
                          </td>
                          <td className="py-2.5 pl-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {formatDurationProfessional(
                              getMinutesByEmployee(
                                data?.totalWorkingMinutesByEmployee || {},
                                rec.employeeName,
                              ),
                            )}
                          </td>
                          <td className="py-2.5 pl-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {formatDurationProfessional(
                              getMinutesByEmployee(
                                data?.totalBreakMinutesByEmployee || {},
                                rec.employeeName,
                              ),
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {employeeRows.length === 0 && (
                <p className="py-8 text-center text-slate-500 dark:text-slate-400">
                  No tardiness in the selected date range for the selected
                  filters.
                </p>
              )}
            </div>
          </div>

          {/* Summary totals card */}
          {dateColumns.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-white/[0.03] shadow-sm backdrop-blur-sm">
              <div className="border-b border-slate-200 dark:border-white/10 px-6 pb-4 pt-5">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Total tardiness ({formatDate(rangeStart)} –{" "}
                  {formatDate(rangeEnd)})
                </h2>
              </div>
              <div className="max-h-[50vh] overflow-auto px-6 py-4 pr-2 pb-2 [scrollbar-color:rgba(99,102,241,0.55)_#e2e8f0] dark:[scrollbar-color:rgba(99,102,241,0.55)_rgba(15,23,42,0.7)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200 dark:[&::-webkit-scrollbar-track]:bg-slate-900/70 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-indigo-400/60 [&::-webkit-scrollbar-thumb:hover]:bg-indigo-300/70">
                <table className="w-full min-w-[400px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10">
                      {dateColumns.map((col) => (
                        <th
                          key={col.dateKey}
                          className="whitespace-nowrap px-2 pb-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="whitespace-nowrap pb-3 pl-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="divide-x divide-slate-200 dark:divide-white/10">
                      {dateColumns.map((col) => (
                        <td
                          key={col.dateKey}
                          className="px-2 py-3 text-right tabular-nums text-slate-900 dark:text-slate-100"
                        >
                          {totalsByDate[col.dateKey] ?? 0} min
                        </td>
                      ))}
                      <td className="py-3 pl-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {rangeTotal} min
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {progressPercent > 0 &&
        modalRoot &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-tardiness-busy-title"
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
                  <div
                    className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-violet-500/25 via-indigo-400/20 to-cyan-400/25 blur-xl"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute inset-1 rounded-full border-2 border-dashed border-indigo-400/35 dark:border-indigo-400/25"
                    aria-hidden
                  />
                  <div className="relative flex flex-col items-center justify-center gap-1.5">
                    <div className="relative flex items-center justify-center">
                      <FiZap
                        className="absolute -right-1 -top-1 h-5 w-5 text-cyan-400 motion-safe:animate-pulse sm:h-6 sm:w-6"
                        aria-hidden
                      />
                      <FiLoader
                        className="h-12 w-12 text-indigo-600 drop-shadow-[0_0_10px_rgba(99,102,241,0.45)] motion-safe:animate-spin dark:text-indigo-400 sm:h-14 sm:w-14"
                        style={{ animationDuration: "1.05s" }}
                        aria-hidden
                      />
                    </div>
                    <span className="text-[1.65rem] font-bold tabular-nums tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                      {Math.round(progressPercent)}
                      <span className="text-lg font-semibold text-indigo-500 dark:text-indigo-300 sm:text-xl">
                        %
                      </span>
                    </span>
                  </div>
                </div>
                <h2
                  id="weekly-tardiness-busy-title"
                  className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white sm:text-xl"
                >
                  Loading tardiness data
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Fetching and calculating weekly tardiness, working hours, and break hours.
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
    </div>
  );
}



