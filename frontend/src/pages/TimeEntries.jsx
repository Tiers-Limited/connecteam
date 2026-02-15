import { useEffect, useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import { getTimeEntriesRange } from '../services/timeEntryService';
import { syncFromConnecteams, getConnecteamTimeEntries } from '../services/connecteamsService';
import { toDateString, getDateRangeColumns } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const PAGE_SIZES = [10, 25, 50, 100];
const STORAGE_KEY_VIEW = 'timeEntries_view';
const STORAGE_KEY_DATA = 'timeEntries_data';

function loadPersistedView() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_VIEW);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p?.viewStartDate && p?.viewEndDate) return p;
    return null;
  } catch {
    return null;
  }
}

function savePersistedView(viewStartDate, viewEndDate) {
  try {
    if (viewStartDate && viewEndDate) {
      sessionStorage.setItem(STORAGE_KEY_VIEW, JSON.stringify({ viewStartDate, viewEndDate }));
    }
  } catch (_) {}
}

function loadPersistedData() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_DATA);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersistedData(data) {
  try {
    if (data?.entries && Array.isArray(data.entries)) {
      sessionStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
    }
  } catch (_) {}
}

/** Parse "HH:mm" to minutes since midnight for comparison */
function timeToMinutes(str) {
  if (!str || typeof str !== 'string') return NaN;
  const [h, m] = str.trim().split(':').map(Number);
  if (Number.isNaN(h)) return NaN;
  return (h || 0) * 60 + (Number.isNaN(m) ? 0 : m);
}

export default function TimeEntries() {
  const { selectedLocationId, setSelectedLocationId, locations, timeEntriesCache, setTimeEntriesCache } = useApp();
  const [viewStartDate, setViewStartDate] = useState(() => {
    const p = loadPersistedView();
    return p?.viewStartDate ?? toDateString(new Date());
  });
  const [viewEndDate, setViewEndDate] = useState(() => {
    const p = loadPersistedView();
    return p?.viewEndDate ?? toDateString(new Date());
  });
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fetchingConnecteam, setFetchingConnecteam] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const location = locations.find((l) => l._id === selectedLocationId);

  const load = useCallback(async (overrideStart, overrideEnd) => {
    if (!selectedLocationId) return;
    const start = overrideStart ?? viewStartDate;
    let end = overrideEnd ?? viewEndDate;
    if (!end || new Date(end) < new Date(start)) end = start;
    if (!overrideStart && !overrideEnd) setViewEndDate(end);
    setLoading(true);
    try {
      const ents = await getTimeEntriesRange(selectedLocationId, start, end);
      const cache = { locationId: selectedLocationId, startDate: start, endDate: end, entries: ents ?? [] };
      setEntries(ents ?? []);
      setTimeEntriesCache(cache);
      savePersistedData(cache);
      setCurrentPage(1);
    } catch (e) {
      // logged in api
    } finally {
      setLoading(false);
    }
  }, [selectedLocationId, viewStartDate, viewEndDate, setTimeEntriesCache]);

  useEffect(() => {
    savePersistedView(viewStartDate, viewEndDate);
  }, [viewStartDate, viewEndDate]);

  useEffect(() => {
    if (!selectedLocationId) return;
    const cache = timeEntriesCache;
    const cacheMatches =
      cache.locationId === selectedLocationId &&
      cache.startDate === viewStartDate &&
      cache.endDate === viewEndDate &&
      Array.isArray(cache.entries);
    if (cacheMatches) {
      setEntries(cache.entries);
      return;
    }
    const stored = loadPersistedData();
    const storedMatches =
      stored?.locationId === selectedLocationId &&
      stored?.startDate === viewStartDate &&
      stored?.endDate === viewEndDate &&
      Array.isArray(stored.entries);
    if (storedMatches) {
      setEntries(stored.entries);
      setTimeEntriesCache(stored);
      return;
    }
    load();
  }, [selectedLocationId, viewStartDate, viewEndDate, timeEntriesCache, load, setTimeEntriesCache]);

  const handleLoadFromConnecteams = async () => {
    let start = viewStartDate;
    let end = viewEndDate;
    if (!end || new Date(end) < new Date(start)) end = start;
    setViewEndDate(end);
    setSyncing(true);
    try {
      const result = await syncFromConnecteams(start, end);
      toast.success(`Synced ${result.synced} time entries to DB.`);
      await load(start, end);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      toast.error('Connecteams sync failed: ' + msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleFetchFromConnecteam = async () => {
    if (!selectedLocationId) return;
    let start = viewStartDate;
    let end = viewEndDate;
    if (!end || new Date(end) < new Date(start)) end = start;
    setFetchingConnecteam(true);
    try {
      const connecteamEntries = await getConnecteamTimeEntries(selectedLocationId, start, end);
      if (connecteamEntries?.length > 0) {
        console.log('[TimeEntries] Connecteam time-entries API', {
          api: 'GET /api/connecteams/time-entries',
          params: { locationId: selectedLocationId, startDate: start, endDate: end },
          firstEntry: connecteamEntries[0],
        });
      }
      const cache = { locationId: selectedLocationId, startDate: start, endDate: end, entries: connecteamEntries };
      setEntries(connecteamEntries);
      setTimeEntriesCache(cache);
      savePersistedData(cache);
      setCurrentPage(1);
      toast.success(`Loaded ${connecteamEntries.length} entries from Connecteam for this location.`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      toast.error('Fetch from Connecteam failed: ' + msg);
    } finally {
      setFetchingConnecteam(false);
    }
  };

  const handleApplyRange = () => {
    load();
  };

  const formatEntryDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    return isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
  };

  // Group by employee+date: first clock-in and last clock-out per day. Must be before any early return (Rules of Hooks).
  const groupedRows = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const empId = e.employeeId?._id ?? e.employeeId;
      const dateStr = formatEntryDate(e.date);
      const key = `${empId}|${dateStr}`;
      const clockInMins = timeToMinutes(e.clockIn);
      const clockOutMins = timeToMinutes(e.clockOut);
      if (!map.has(key)) {
        map.set(key, {
          _id: e._id,
          date: e.date,
          employeeId: e.employeeId,
          clockIn: e.clockIn,
          clockOut: e.clockOut,
          _clockInMins: Number.isNaN(clockInMins) ? Infinity : clockInMins,
          _clockOutMins: Number.isNaN(clockOutMins) ? -1 : clockOutMins,
        });
      } else {
        const row = map.get(key);
        if (!Number.isNaN(clockInMins) && clockInMins < row._clockInMins) {
          row.clockIn = e.clockIn;
          row._clockInMins = clockInMins;
        }
        if (!Number.isNaN(clockOutMins) && clockOutMins > row._clockOutMins) {
          row.clockOut = e.clockOut;
          row._clockOutMins = clockOutMins;
        }
      }
    }
    const rows = Array.from(map.values()).map(({ _clockInMins, _clockOutMins, ...r }) => r);
    rows.sort((a, b) => {
      const d = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (d !== 0) return d;
      return (a.employeeId?.name ?? '').localeCompare(b.employeeId?.name ?? '');
    });
    return rows;
  }, [entries]);

  // Pivot: one row per employee, date columns (02 Feb | 03 Feb | ...) like WeeklyTardiness. Must be before early return.
  const dateColumns = useMemo(
    () => getDateRangeColumns(viewStartDate, viewEndDate),
    [viewStartDate, viewEndDate]
  );
  const employeeRows = useMemo(() => {
    const byEmployee = new Map();
    for (const row of groupedRows) {
      const name = row.employeeId?.name ?? '—';
      const empKey = row.employeeId?._id ?? row.employeeId ?? name;
      if (!byEmployee.has(empKey)) {
        byEmployee.set(empKey, { employeeName: name, byDate: {} });
      }
      const rec = byEmployee.get(empKey);
      const dateStr = formatEntryDate(row.date);
      rec.byDate[dateStr] = { clockIn: row.clockIn, clockOut: row.clockOut };
    }
    return Array.from(byEmployee.values()).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName)
    );
  }, [groupedRows]);

  if (!selectedLocationId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Time Entries</h1>
        <Card>
          <p className="text-slate-600 dark:text-slate-400">Loading locations…</p>
        </Card>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(employeeRows.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const startIdx = (page - 1) * pageSize;
  const pageEmployeeRows = employeeRows.slice(startIdx, startIdx + pageSize);

  const spinner = (
    <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Time Entries</h1>
      <p className="text-slate-600 dark:text-slate-400">
        {location?.name} — Clock-in/out (AM 06:00–15:00, PM 15:00–23:00). Data is filtered by location and date range. Location is used when syncing from Connecteams (entries are stored per location).
      </p>

      <Card title="Location & date range">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">Location</label>
            <select
              value={selectedLocationId || ''}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 min-w-[160px]"
            >
              {locations.map((loc) => (
                <option key={loc._id} value={loc._id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <Input
            label="Start date"
            type="date"
            value={viewStartDate}
            onChange={(e) => setViewStartDate(e.target.value)}
          />
          <Input
            label="End date"
            type="date"
            value={viewEndDate}
            onChange={(e) => setViewEndDate(e.target.value)}
          />
          <Button type="button" variant="secondary" onClick={handleApplyRange} disabled={loading}>
            {loading ? (
              <>
                {spinner}
                Loading…
              </>
            ) : (
              'Load range'
            )}
          </Button>
        </div>
      </Card>

      <Card title="Connecteams & DB">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          <strong>Save to DB:</strong> Sync time entries from Connecteams for the date range above into the database (all 4 locations). Existing entries in the range are replaced. <strong>Load range</strong> above reads from DB. After saving, the table refreshes from DB.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <Button
            type="button"
            onClick={handleLoadFromConnecteams}
            disabled={syncing}
          >
            {syncing ? (
              <>
                {spinner}
                Saving to DB…
              </>
            ) : (
              'Save to DB (sync from Connecteams)'
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleFetchFromConnecteam}
            disabled={fetchingConnecteam}
          >
            {fetchingConnecteam ? (
              <>
                {spinner}
                Fetching…
              </>
            ) : (
              'Preview from Connecteam (this location, not saved)'
            )}
          </Button>
        </div>
      </Card>

      <Card title="Time entries">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {viewStartDate} – {viewEndDate} · {employeeRows.length} employee(s)
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="whitespace-nowrap pb-3 pr-4 text-left font-semibold text-slate-700 dark:text-slate-300">
                  Employee
                </th>
                {dateColumns.map((col) => (
                  <th
                    key={col.dateKey}
                    className="whitespace-nowrap pb-3 px-2 text-left font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {pageEmployeeRows.map((rec, i) => (
                <tr key={`${rec.employeeName}-${startIdx + i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2.5 pr-4 font-medium">{rec.employeeName}</td>
                  {dateColumns.map((col) => {
                    const day = rec.byDate[col.dateKey];
                    const hasData = day?.clockIn != null || day?.clockOut != null;
                    return (
                      <td key={col.dateKey} className="py-2.5 px-2 text-slate-700 dark:text-slate-300">
                        {hasData ? (
                          <span className="block text-slate-600 dark:text-slate-400">
                            {day.clockIn ?? '–'} – {day.clockOut ?? '–'}
                          </span>
                        ) : (
                          '–'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {employeeRows.length === 0 && (
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">No entries for this location and date range. Use <strong>Load range</strong> to read from DB, or <strong>Save to DB</strong> to sync from Connecteams.</p>
        )}
        {employeeRows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              Previous
            </button>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Page {page} of {totalPages} ({employeeRows.length} total)
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
