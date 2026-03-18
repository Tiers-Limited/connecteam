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
  AreaChart,
  Area,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { getDashboardSummary } from '../services/dashboardService';
import { SkeletonBox } from '../skeletons';
import { formatDate } from '../utils/dateUtils';

const CACHE_TTL_MS = 60 * 1000;
let cachedSummary = null;
let cachedAt = 0;

function formatMoney(n) {
  return '$' + (Number(n) ?? 0).toFixed(2);
}

function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  const displayLabel = labelFormatter ? labelFormatter(label, payload) : label;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg">
      {displayLabel && <div className="mb-0.5 font-medium text-slate-700">{displayLabel}</div>}
      <div className="text-slate-600">{formatter ? formatter(value) : value}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <SkeletonBox className="h-8 w-48 rounded-md" />
          <SkeletonBox className="h-4 w-full max-w-md rounded-md" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          'border-indigo-100 from-indigo-500/10 to-indigo-600/5',
          'border-emerald-100 from-emerald-500/10 to-emerald-600/5',
          'border-amber-100 from-amber-500/10 to-amber-600/5',
          'border-violet-100 from-violet-500/10 to-violet-600/5',
        ].map((cls, i) => (
          <div key={i} className={`rounded-xl border bg-gradient-to-br p-5 shadow-sm ${cls}`}>
            <SkeletonBox className="mb-3 h-3 w-20 rounded" />
            <SkeletonBox className="mb-2 h-8 w-14 rounded-md" />
            <SkeletonBox className="mt-2 h-3 w-24 rounded" />
            {(i === 0 || i === 2 || i === 3) && <SkeletonBox className="mt-2 h-3 w-20 rounded" />}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
            <SkeletonBox className="mb-1 h-6 w-56 rounded-md" />
            <SkeletonBox className="mb-4 h-4 w-full max-w-sm rounded" />
            <div className="flex h-[280px] items-end justify-around gap-2 px-2 pb-8 pt-4">
              {[40, 65, 45, 80, 55, 70].map((h, j) => (
                <SkeletonBox key={j} className="w-full flex-1 rounded-t-md" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
        <SkeletonBox className="mb-4 h-6 w-28 rounded-md" />
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5].map((i) => <SkeletonBox key={i} className="h-10 w-28 rounded-lg" />)}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { locations, refreshLocations } = useApp();
  const [summary, setSummary] = useState(() => {
    if (cachedSummary && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSummary;
    return null;
  });
  const [loading, setLoading] = useState(!cachedSummary);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const hasCache = cachedSummary && Date.now() - cachedAt < CACHE_TTL_MS;
      if (hasCache) {
        setSummary(cachedSummary);
        setLoading(false);
        setRefreshing(true);
      }

      try {
        await refreshLocations();
        const data = await getDashboardSummary();
        if (!cancelled) {
          setSummary(data);
          cachedSummary = data;
          cachedAt = Date.now();
        }
      } catch (_) {
        if (!cancelled && !hasCache) setSummary(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [refreshLocations]);

  if (loading && !summary) return <DashboardSkeleton />;

  const payoutByLocation = summary?.payoutByLocation ?? [];
  const dailyTipsLast7 = summary?.dailyTipsLast7 ?? [];
  const weekLabel =
    summary?.currentWeekStart && summary?.weekEnd
      ? (() => {
          const startDay = parseInt(summary.currentWeekStart.slice(8, 10), 10) || 0;
          const endDay = parseInt(summary.weekEnd.slice(8, 10), 10) || 0;
          const month = new Date(summary.weekEnd + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short' });
          return `Previous week (${startDay}–${endDay} ${month})`;
        })()
      : 'Previous week';

  const payoutChartData = payoutByLocation.map((l) => ({ name: l.locationName, payout: l.totalPayable }));
  const dailyChartData = dailyTipsLast7.map((d) => ({
    date: d.date,
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    gross: d.totalGross,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Previous week analysis: tips, payouts, and production pool. Load data from Weekly Payout and Production Pool for the prior week.
          </p>
        </div>
        {refreshing && <span className="text-xs text-slate-400">Updating…</span>}
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Locations</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">
            {summary?.locationsCount ?? locations.length ?? 0}
          </p>
         
        </div>

        <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Employees</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">
            {summary?.employeesCount ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">Active (all locations)</p>
        </div>

        <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-500/10 to-amber-600/5 p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Front staff payout</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">
            {formatMoney(summary?.totalPayoutThisWeek ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{weekLabel}</p>
          <Link to="/weekly-payout" className="mt-2 inline-block text-xs font-medium text-amber-600 hover:underline">
            Weekly Payout →
          </Link>
        </div>

        <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-500/10 to-violet-600/5 p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Production pool</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">
            {formatMoney(summary?.productionTotal ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{weekLabel}</p>
          <Link to="/production-pool" className="mt-2 inline-block text-xs font-medium text-violet-600 hover:underline">
            Production Pool →
          </Link>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Weekly Payout by Location */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-700">Weekly payout by location</h2>
          <p className="mb-4 mt-1 text-sm text-slate-500">
            Previous week (Mon–Sun) tips payable per location.
          </p>
          <div className="min-h-[280px] flex-1">
            {payoutChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={payoutChartData}
                  margin={{ top: 12, right: 12, left: 0, bottom: 24 }}
                  barCategoryGap="20%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    interval={0}
                    angle={payoutChartData.length > 4 ? -25 : 0}
                    textAnchor={payoutChartData.length > 4 ? 'end' : 'middle'}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v) => formatMoney(v)}
                    width={52}
                  />
                  <Tooltip
                    content={<ChartTooltip formatter={formatMoney} />}
                    cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                  />
                  <Bar
                    dataKey="payout"
                    name="Payable"
                    radius={[6, 6, 0, 0]}
                    fill="rgb(99 102 241)"
                    maxBarSize={56}
                    isAnimationActive={!refreshing}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                <p className="text-center text-sm text-slate-500">
                  No payout data. Load from{' '}
                  <Link to="/weekly-payout" className="font-medium text-indigo-600 hover:underline">Weekly Payout</Link>.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Daily gross tips */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-700">Daily gross tips (previous week)</h2>
          <p className="mb-4 mt-1 text-sm text-slate-500">
            AM + PM gross tips by day for the previous week (Mon–Sun), all locations.
          </p>
          <div className="min-h-[280px] flex-1">
            {dailyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={dailyChartData}
                  margin={{ top: 12, right: 12, left: 0, bottom: 24 }}
                >
                  <defs>
                    <linearGradient id="grossGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v) => formatMoney(v)}
                    width={52}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(v) => formatMoney(v) + ' gross tips'}
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.date ? formatDate(payload[0].payload.date) : ''
                        }
                      />
                    }
                    cursor={{ stroke: 'rgb(148 163 184)', strokeDasharray: '4 4', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="gross"
                    stroke="rgb(16 185 129)"
                    strokeWidth={2}
                    fill="url(#grossGradient)"
                    dot={{ fill: 'rgb(16 185 129)', strokeWidth: 0, r: 4 }}
                    activeDot={{ r: 5, fill: 'white', stroke: 'rgb(16 185 129)', strokeWidth: 2 }}
                    isAnimationActive={!refreshing}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                <p className="text-center text-sm text-slate-500">
                  No data. Enter in{' '}
                  <Link to="/daily-tips" className="font-medium text-indigo-600 hover:underline">Daily Tips</Link>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-700">Quick links</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/daily-tips"
            className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
          >
            Daily Tips
          </Link>
          <Link
            to="/weekly-payout"
            className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100"
          >
            Weekly Payout
          </Link>
          <Link
            to="/weekly-tardiness"
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            Weekly Tardiness
          </Link>
          <Link
            to="/production-pool"
            className="rounded-lg border border-violet-100 bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
          >
            Production Pool
          </Link>
          <Link
            to="/time-entries"
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            Time Entries
          </Link>
        </div>
      </div>
    </div>
  );
}