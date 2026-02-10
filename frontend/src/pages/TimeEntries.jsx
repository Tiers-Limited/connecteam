import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../context/AppContext';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { SkeletonPage } from '../skeletons';
import { getTimeEntriesRange } from '../services/timeEntryService';
import { syncFromConnecteams } from '../services/connecteamsService';
import { toDateString } from '../utils/dateUtils';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const PAGE_SIZES = [10, 25, 50, 100];

export default function TimeEntries() {
  const { selectedLocationId, setSelectedLocationId, locations, timeEntriesCache, setTimeEntriesCache } = useApp();
  const [viewStartDate, setViewStartDate] = useState(toDateString(new Date()));
  const [viewEndDate, setViewEndDate] = useState(toDateString(new Date()));
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const showSkeleton = useDelayedLoading(loading);

  const location = locations.find((l) => l._id === selectedLocationId);

  const load = useCallback(async () => {
    if (!selectedLocationId) return;
    setLoading(true);
    try {
      let start = viewStartDate;
      let end = viewEndDate;
      if (!end || new Date(end) < new Date(start)) end = start;
      setViewEndDate(end);
      const ents = await getTimeEntriesRange(selectedLocationId, start, end);
      setEntries(ents);
      setTimeEntriesCache({ locationId: selectedLocationId, startDate: start, endDate: end, entries: ents });
      setCurrentPage(1);
    } catch (e) {
      // logged in api
    } finally {
      setLoading(false);
    }
  }, [selectedLocationId, viewStartDate, viewEndDate, setTimeEntriesCache]);

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
      setLoading(false);
      return;
    }
    load();
  }, [selectedLocationId, viewStartDate, viewEndDate, load]);

  const handleLoadFromConnecteams = async () => {
    let start = viewStartDate;
    let end = viewEndDate;
    if (!end || new Date(end) < new Date(start)) end = start;
    setViewEndDate(end);
    setSyncing(true);
    try {
      const result = await syncFromConnecteams(start, end);
      toast.success(`Synced ${result.synced} time entries from Connecteams.`);
      await load();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      toast.error('Connecteams sync failed: ' + msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleApplyRange = () => {
    load();
  };

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

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const startIdx = (page - 1) * pageSize;
  const pageEntries = entries.slice(startIdx, startIdx + pageSize);

  const formatEntryDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    return isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
  };

  if (showSkeleton && loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Time Entries</h1>
        <SkeletonPage variant="table" />
      </div>
    );
  }

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
            Load range
          </Button>
        </div>
      </Card>

      <Card title="Load from Connecteams API">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Sync employees and time entries for the 4 locations (Oranjestad, Casa del Mar, The Cove, Drive Thru) from Connecteams for the date range above. Existing synced entries in the range will be replaced.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <Button
            type="button"
            onClick={handleLoadFromConnecteams}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Load from Connecteams'}
          </Button>
        </div>
      </Card>

      <Card title="Time entries (from Connecteams)">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {viewStartDate} – {viewEndDate} · {entries.length} row(s)
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
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="pb-3 text-left text-sm font-semibold">Date</th>
                <th className="pb-3 text-left text-sm font-semibold">Employee</th>
                <th className="pb-3 text-left text-sm font-semibold">Clock In</th>
                <th className="pb-3 text-left text-sm font-semibold">Clock Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {pageEntries.map((e) => (
                <tr key={e._id}>
                  <td className="py-3">{formatEntryDate(e.date)}</td>
                  <td className="py-3">{e.employeeId?.name ?? '—'}</td>
                  <td className="py-3">{e.clockIn}</td>
                  <td className="py-3">{e.clockOut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && (
          <p className="py-8 text-center text-slate-500 dark:text-slate-400">No entries for this location and date range. Sync from Connecteams or adjust the range.</p>
        )}
        {entries.length > 0 && (
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
              Page {page} of {totalPages} ({entries.length} total)
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
