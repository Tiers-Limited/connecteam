import { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { SkeletonPage } from '../skeletons';
import { getWeeklyTardiness } from '../services/weeklyTardinessService';
import { toDateString, getWeekStart, formatWeekRange } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PAGE_SIZES = [10, 25, 50, 100];
const STORAGE_KEY = 'weeklyTardiness_data';

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

export default function WeeklyTardiness() {
  const { selectedLocationId, setSelectedLocationId, locations } = useApp();
  const [weekStart, setWeekStart] = useState(() =>
    toDateString(getWeekStart(new Date()))
  );
  const [data, setData] = useState(loadPersistedData);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const showSkeleton = useDelayedLoading(loading);

  useEffect(() => {
    savePersistedData(data);
  }, [data]);

  const loadTardiness = useCallback(async () => {
    setLoading(true);
    setData(null);
    setPage(1);
    try {
      const result = await getWeeklyTardiness(
        weekStart,
        selectedLocationId || undefined
      );
      setData(result);
      toast.success(
        `Loaded ${result?.entries?.length ?? 0} tardiness entries for the week.`
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

  const totalRows = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const paginatedEntries = entries.slice(start, start + pageSize);

  if (showSkeleton && loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          Weekly Tardiness
        </h1>
        <SkeletonPage variant="table" />
      </div>
    );
  }

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
            {loading ? 'Loading…' : 'Load from Connecteam'}
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

          <Card title="Tardiness detail (Employee – Location/Job – Scheduled – Clock in – Minutes late)">
            {totalRows > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {totalRows} entr{totalRows !== 1 ? 'ies' : 'y'}
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
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="whitespace-nowrap pb-3 text-left font-semibold text-slate-700 dark:text-slate-300">
                      Employee
                    </th>
                    <th className="whitespace-nowrap pb-3 text-left font-semibold text-slate-700 dark:text-slate-300">
                      Location/Job
                    </th>
                    <th className="whitespace-nowrap pb-3 text-left font-semibold text-slate-700 dark:text-slate-300">
                      Date
                    </th>
                    <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Scheduled time
                    </th>
                    <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Clock in time
                    </th>
                    <th className="whitespace-nowrap pb-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Minutes late
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {paginatedEntries.map((row, i) => (
                    <tr
                      key={`${row.employeeName}-${row.date}-${row.clockIn}-${start + i}`}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="py-2.5 font-medium">{row.employeeName}</td>
                      <td className="py-2.5">{row.locationName}</td>
                      <td className="py-2.5">{row.date}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        {row.scheduledTime}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {row.clockIn}
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-medium">
                        {row.minutesLate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {entries.length === 0 && (
              <p className="py-8 text-center text-slate-500 dark:text-slate-400">
                No tardiness in this week for the selected filters.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
