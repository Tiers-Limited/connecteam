import { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import { getWeeklyTardiness } from '../services/weeklyTardinessService';
import { toDateString, getWeekStart, formatWeekRange, getWeekDateColumns } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PAGE_SIZES = [10, 25, 50, 100];

/** Parse "HH:mm" to minutes since midnight for comparison (earliest clock-in = first punch of day) */
function timeToMinutes(str) {
  if (!str || typeof str !== 'string') return Infinity;
  const [h, m] = str.trim().split(':').map(Number);
  if (Number.isNaN(h)) return Infinity;
  return (h || 0) * 60 + (Number.isNaN(m) ? 0 : m);
}

export default function WeeklyTardiness() {
  const { selectedLocationId, setSelectedLocationId, locations } = useApp();
  const [weekStart, setWeekStart] = useState(() =>
    toDateString(getWeekStart(new Date()))
  );
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /** Load from DB cache when week or location changes (no Connecteam API call). */
  const loadFromCache = useCallback(async () => {
    try {
      const result = await getWeeklyTardiness(
        weekStart,
        selectedLocationId || undefined,
        false
      );
      if (result && (result.entries?.length > 0 || (result.weekTotal ?? 0) > 0)) {
        setData(result);
        setPage(1);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    }
  }, [weekStart, selectedLocationId]);

  useEffect(() => {
    loadFromCache();
  }, [loadFromCache]);

  /** Fetch from Connecteam API and save to DB, then show data. */
  const loadTardiness = useCallback(async () => {
    setLoading(true);
    setData(null);
    setPage(1);
    try {
      const result = await getWeeklyTardiness(
        weekStart,
        selectedLocationId || undefined,
        true
      );
      setData(result);
      const seen = new Set();
      (result?.entries ?? []).forEach((entry) => {
        const uid = entry.connecteamsUserId ?? entry.employeeName;
        if (uid && !seen.has(uid)) {
          seen.add(uid);
          console.log('User:', { userId: entry.connecteamsUserId, username: entry.employeeName });
        }
      });
      toast.success(
        `Loaded ${result?.entries?.length ?? 0} tardiness entries from Connecteam and saved to database.`
      );
    } catch (err) {
      setData(null);
      const msg =
        err.response?.data?.error || err.message || 'Failed to load tardiness';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [weekStart, selectedLocationId]);

  const location = locations.find((l) => l._id === selectedLocationId);
  const entries = data?.entries ?? [];
  const dailyTotals = data?.dailyTotals ?? {};
  const weekTotal = data?.weekTotal ?? 0;
  const weekDateColumns = data ? getWeekDateColumns(weekStart) : [];

  // Pivot: one row per employee, week dates as columns. Use earliest clock-in of the day (first punch)
  // and that punch's minutes late only. If first punch is before scheduled time → 0 min late.
  const employeeMap = new Map();
  for (const row of entries) {
    const key = row.employeeName;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, { employeeName: key, locationName: row.locationName, byDate: {} });
    }
    const rec = employeeMap.get(key);
    const d = row.date;
    const mins = Math.max(0, Number(row.minutesLate) || 0);
    const clockInMins = timeToMinutes(row.clockIn);
    if (!rec.byDate[d]) {
      rec.byDate[d] = {
        minutesLate: mins,
        scheduledTime: row.scheduledTime,
        clockIn: row.clockIn,
        _earliestMins: clockInMins,
      };
    } else {
      if (clockInMins < rec.byDate[d]._earliestMins) {
        rec.byDate[d].scheduledTime = row.scheduledTime;
        rec.byDate[d].clockIn = row.clockIn;
        rec.byDate[d].minutesLate = mins;
        rec.byDate[d]._earliestMins = clockInMins;
      }
    }
  }
  // Drop internal _earliestMins from byDate (not needed for render)
  employeeMap.forEach((rec) => {
    Object.keys(rec.byDate || {}).forEach((d) => {
      delete rec.byDate[d]._earliestMins;
    });
  });
  const employeeRows = Array.from(employeeMap.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );

  const totalRows = employeeRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const paginatedRows = employeeRows.slice(start, start + pageSize);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          Weekly Tardiness
        </h1>
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
              <option value="">All locations</option>
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
          <Button onClick={loadTardiness} disabled={loading}>
            {loading ? (
              <>
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
                Loading…
              </>
            ) : (
              'Load from Connecteam'
            )}
          </Button>
        </div>
      </div>

      <p className="text-slate-600 dark:text-slate-400">
        {selectedLocationId && location
          ? `${location.name} — `
          : 'All locations — '}
        {formatWeekRange(weekStart)}. Tardiness = minutes late (clock-in after
        scheduled start). Data from Connecteam schedulers and time clock.
      </p>

      {!data && !loading && (
        <Card>
          <p className="py-6 text-center text-slate-500 dark:text-slate-400">
            Select week (and optionally a location), then click{' '}
            <strong>Load from Connecteam</strong> to fetch tardiness data.
          </p>
        </Card>
      )}

      {data && (
        <>
          <Card title="Tardiness by employee (minutes late per day)">
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
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                    <th className="whitespace-nowrap pb-3 pr-4 text-left font-semibold text-slate-700 dark:text-slate-300">
                      Employee
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-left font-semibold text-slate-700 dark:text-slate-300">
                      Location/Job
                    </th>
                    {weekDateColumns.map((col) => (
                      <th
                        key={col.dateKey}
                        className="whitespace-nowrap pb-3 px-2 text-right font-semibold text-slate-700 dark:text-slate-300"
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap pb-3 pl-2 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Week total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {paginatedRows.map((rec, i) => {
                    const rowTotal = weekDateColumns.reduce((sum, col) => {
                      const dayRec = rec.byDate[col.dateKey];
                      const raw = dayRec?.minutesLate ?? 0;
                      const s = (dayRec?.scheduledTime ?? '').toString().trim();
                      const c = (dayRec?.clockIn ?? '').toString().trim();
                      const mins = (s && s === c) ? 0 : Math.max(0, Number(raw) || 0);
                      return sum + mins;
                    }, 0);
                    return (
                      <tr
                        key={`${rec.employeeName}-${start + i}`}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="py-2.5 pr-4 font-medium">{rec.employeeName}</td>
                        <td className="py-2.5 pr-4">{rec.locationName}</td>
                        {weekDateColumns.map((col) => {
                          const dayRec = rec.byDate[col.dateKey];
                          const rawMinutes = dayRec?.minutesLate;
                          // Same time (e.g. 07:00 → 07:00) = 0 min; 06:30 → 06:31 = 1 min. Show "–" when not late.
                          const scheduledStr = (dayRec?.scheduledTime ?? '').toString().trim();
                          const clockInStr = (dayRec?.clockIn ?? '').toString().trim();
                          const minutes = (scheduledStr && scheduledStr === clockInStr) ? 0 : Math.max(0, Number(rawMinutes) || 0);
                          const isLate = minutes > 0;
                          return (
                            <td
                              key={col.dateKey}
                              className="py-2.5 px-2 text-right tabular-nums align-top"
                            >
                              {isLate ? (
                                <span className="inline-block text-right">
                                  <span className="block text-slate-600 dark:text-slate-400">
                                    {dayRec.scheduledTime ?? '–'} → {dayRec.clockIn ?? '–'}
                                  </span>
                                  <span className="font-medium">{minutes} min</span>
                                </span>
                              ) : (
                                '–'
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 pl-2 text-right tabular-nums font-medium">
                          {rowTotal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {employeeRows.length === 0 && (
              <p className="py-8 text-center text-slate-500 dark:text-slate-400">
                No tardiness in this week for the selected filters.
              </p>
            )}
          </Card>

          <Card title="Weekly total tardiness (Mon–Sun)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    {DAY_LABELS.map((label) => (
                      <th
                        key={label}
                        className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300"
                      >
                        {label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Week total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="divide-x divide-slate-200 dark:divide-slate-700">
                    {DAY_KEYS.map((key) => (
                      <td
                        key={key}
                        className="py-3 text-right tabular-nums text-slate-800 dark:text-slate-200"
                      >
                        {dailyTotals[key] ?? 0} min
                      </td>
                    ))}
                    <td className="py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                      {weekTotal} min
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
