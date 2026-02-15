import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { SkeletonPage } from '../skeletons';
import { getDashboardSummary } from '../services/dashboardService';
import Card from '../components/ui/Card';
import { formatDate } from '../utils/dateUtils';

const BAR_COLORS = ['#4f46e5', '#059669', '#d97706', '#dc2626'];

function formatMoney(n) {
  return '$' + (Number(n) ?? 0).toFixed(2);
}

export default function Dashboard() {
  const { locations, refreshLocations } = useApp();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useDelayedLoading(loading);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        await refreshLocations();
        const data = await getDashboardSummary();
        if (!cancelled) setSummary(data);
      } catch (_) {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshLocations]);

  if (showSkeleton && loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
        <SkeletonPage variant="cards" />
      </div>
    );
  }

  const payoutByLocation = summary?.payoutByLocation ?? [];
  const dailyTipsLast7 = summary?.dailyTipsLast7 ?? [];
  const weekLabel = summary?.currentWeekStart
    ? `${formatDate(summary.currentWeekStart)} week`
    : 'This week';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Overview of tips, payouts, and production pool. Load payout data from Weekly Payout and Production Pool for charts.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-indigo-500">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Locations</p>
          <p className="mt-1 text-3xl font-bold text-slate-800 dark:text-slate-100">
            {summary?.locationsCount ?? locations.length ?? 0}
          </p>
          <Link to="/time-entries" className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Time Entries →
          </Link>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Employees</p>
          <p className="mt-1 text-3xl font-bold text-slate-800 dark:text-slate-100">
            {summary?.employeesCount ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active (all locations)</p>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Front staff payout</p>
          <p className="mt-1 text-3xl font-bold text-slate-800 dark:text-slate-100">
            {formatMoney(summary?.totalPayoutThisWeek ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{weekLabel}</p>
          <Link to="/weekly-payout" className="mt-2 text-xs font-medium text-amber-600 hover:underline dark:text-amber-400">
            Weekly Payout →
          </Link>
        </Card>
        <Card className="border-l-4 border-l-violet-500">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Production pool</p>
          <p className="mt-1 text-3xl font-bold text-slate-800 dark:text-slate-100">
            {formatMoney(summary?.productionTotal ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{weekLabel}</p>
          <Link to="/production-pool" className="mt-2 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
            Production Pool →
          </Link>
        </Card>
      </div>

      {/* Weekly Payout by Location */}
      <Card title="Weekly payout by location">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Final weekly tips payable per location (current week). Load payout per location to see data.
        </p>
        <div className="h-72 w-full">
          {payoutByLocation.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={payoutByLocation.map((l) => ({ name: l.locationName, payout: l.totalPayable }))}
                margin={{ top: 16, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: 'currentColor' }}
                  className="text-slate-600 dark:text-slate-400"
                />
                <YAxis
                  tick={{ fontSize: 12, fill: 'currentColor' }}
                  tickFormatter={(v) => '$' + v}
                  className="text-slate-600 dark:text-slate-400"
                />
                <Tooltip
                  formatter={(value) => [formatMoney(value), 'Payable']}
                  contentStyle={{
                    backgroundColor: 'var(--tw-bg-opacity, 1)',
                    border: '1px solid rgb(203 213 225)',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: 'rgb(51 65 85)' }}
                />
                <Bar dataKey="payout" name="Payable" radius={[4, 4, 0, 0]} fill="#4f46e5">
                  {payoutByLocation.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
              No payout data for this week. Load from <Link to="/weekly-payout" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Weekly Payout</Link>.
            </div>
          )}
        </div>
      </Card>

      {/* Daily gross tips – last 7 days */}
      <Card title="Daily gross tips (last 7 days)">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Sum of AM + PM gross tips across all locations per day.
        </p>
        <div className="h-72 w-full">
          {dailyTipsLast7.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dailyTipsLast7.map((d) => ({
                  date: d.date,
                  label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                  gross: d.totalGross,
                }))}
                margin={{ top: 16, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: 'currentColor' }}
                  className="text-slate-600 dark:text-slate-400"
                />
                <YAxis
                  tick={{ fontSize: 12, fill: 'currentColor' }}
                  tickFormatter={(v) => '$' + v}
                  className="text-slate-600 dark:text-slate-400"
                />
                <Tooltip
                  formatter={(value) => [formatMoney(value), 'Gross tips']}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatDate(payload[0].payload.date) : ''}
                  contentStyle={{
                    backgroundColor: 'var(--tw-bg-opacity, 1)',
                    border: '1px solid rgb(203 213 225)',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="gross" name="Gross tips" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
              No daily tip input in the last 7 days. Enter data in <Link to="/daily-tips" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Daily Tips</Link>.
            </div>
          )}
        </div>
      </Card>

      {/* Quick links */}
      <Card title="Quick links">
        <div className="flex flex-wrap gap-4">
          <Link
            to="/daily-tips"
            className="rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
          >
            Daily Tips
          </Link>
          <Link
            to="/weekly-payout"
            className="rounded-lg bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
          >
            Weekly Payout
          </Link>
          <Link
            to="/weekly-tardiness"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          >
            Weekly Tardiness
          </Link>
          <Link
            to="/production-pool"
            className="rounded-lg bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50"
          >
            Production Pool
          </Link>
          <Link
            to="/time-entries"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          >
            Time Entries
          </Link>
        </div>
      </Card>
    </div>
  );
}
