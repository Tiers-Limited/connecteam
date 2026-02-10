import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { SkeletonPage } from '../skeletons';
import { getEmployees } from '../services/employeeService';
import Card from '../components/ui/Card';

export default function Dashboard() {
  const { locations, refreshLocations, selectedLocationId } = useApp();
  const [employeesCount, setEmployeesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useDelayedLoading(loading);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        await refreshLocations();
        const emps = await getEmployees(selectedLocationId || undefined);
        if (!cancelled) setEmployeesCount(Array.isArray(emps) ? emps.length : 0);
      } catch (e) {
        // logged in api
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshLocations, selectedLocationId]);

  if (showSkeleton && loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
        <SkeletonPage variant="cards" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Employees and time entries come from Connecteams API. Use <strong>Time Entries</strong> to sync, then <strong>Daily Tips</strong> to enter gross tips and see calculations.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">Locations</p>
          <p className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
            {locations.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Oranjestad, Casa del Mar, The Cove, Drive Thru</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">Employees (this location)</p>
          <p className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
            {employeesCount}
          </p>
          <Link
            to="/time-entries"
            className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Sync from Connecteams →
          </Link>
        </Card>
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">Daily Tips</p>
          <p className="text-2xl font-semibold text-slate-700 dark:text-slate-300">—</p>
          <Link
            to="/daily-tips"
            className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Enter gross tips →
          </Link>
        </Card>
      </div>
      <Card>
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Weekly Payout</p>
        <Link
          to="/weekly-payout"
          className="mt-1 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          View weekly payout →
        </Link>
      </Card>
    </div>
  );
}
