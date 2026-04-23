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

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  const displayLabel = labelFormatter ? labelFormatter(label, payload) : label;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-sm shadow-xl backdrop-blur">
      {displayLabel && <div className="mb-0.5 font-medium text-slate-200">{displayLabel}</div>}
      <div className="text-slate-300">{formatter ? formatter(value) : value}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <SkeletonBox className="h-8 w-48 rounded-md" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          'border-indigo-400/25 from-indigo-500/20 to-indigo-600/10',
          'border-emerald-400/25 from-emerald-500/20 to-emerald-600/10',
          'border-amber-400/25 from-amber-500/20 to-amber-600/10',
          'border-violet-400/25 from-violet-500/20 to-violet-600/10',
        ].map((cls, i) => (
          <div key={i} className={`rounded-2xl border bg-gradient-to-br p-5 shadow-lg shadow-black/20 ${cls}`}>
            <SkeletonBox className="mb-3 h-3 w-20 rounded" />
            <SkeletonBox className="mb-2 h-8 w-14 rounded-md" />
            {(i === 0 || i === 2 || i === 3) && <SkeletonBox className="mt-2 h-3 w-20 rounded" />}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/20 backdrop-blur">
            <SkeletonBox className="mb-1 h-6 w-56 rounded-md" />
            <div className="flex h-[280px] items-end justify-around gap-2 px-2 pb-8 pt-4">
              {[40, 65, 45, 80, 55, 70].map((h, j) => (
                <SkeletonBox key={j} className="w-full flex-1 rounded-t-md" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/20 backdrop-blur">
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
  const totalPayout = payoutChartData.reduce((sum, item) => sum + (Number(item.payout) || 0), 0);
  const totalDailyGross = dailyChartData.reduce((sum, item) => sum + (Number(item.gross) || 0), 0);
  const avgDailyGross = dailyChartData.length ? totalDailyGross / dailyChartData.length : 0;
  const topLocation = payoutChartData.reduce(
    (best, item) => ((Number(item.payout) || 0) > (Number(best?.payout) || 0) ? item : best),
    payoutChartData[0] ?? null,
  );
  const peakDay = dailyChartData.reduce(
    (best, item) => ((Number(item.gross) || 0) > (Number(best?.gross) || 0) ? item : best),
    dailyChartData[0] ?? null,
  );
  const locationContribution = payoutChartData
    .map((item) => ({
      ...item,
      share: totalPayout ? ((Number(item.payout) || 0) / totalPayout) * 100 : 0,
    }))
    .sort((a, b) => b.share - a.share);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Dashboard</h1>
        </div>
        {refreshing && <span className="text-xs text-slate-400">Updating…</span>}
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-indigo-400/25 bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 p-5 shadow-lg shadow-black/20">
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-200/80">Locations</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-white">
            {summary?.locationsCount ?? locations.length ?? 0}
          </p>
         
        </div>

        <div className="rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-5 shadow-lg shadow-black/20">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-200/80">Employees</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-white">
            {summary?.employeesCount ?? 0}
          </p>
        </div>

        <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/20 to-amber-600/10 p-5 shadow-lg shadow-black/20">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-200/80">Front staff payout</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-white">
            {formatMoney(summary?.totalPayoutThisWeek ?? 0)}
          </p>
          <p className="mt-1 text-xs text-amber-100/70">{weekLabel}</p>
          <Link to="/weekly-payout" className="mt-2 inline-block text-xs font-medium text-amber-300 transition hover:text-amber-200">
            Weekly Payout →
          </Link>
        </div>

        <div className="rounded-2xl border border-violet-400/25 bg-gradient-to-br from-violet-500/20 to-violet-600/10 p-5 shadow-lg shadow-black/20">
          <p className="text-xs font-medium uppercase tracking-wider text-violet-200/80">Production pool</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-white">
            {formatMoney(summary?.productionTotal ?? 0)}
          </p>
          <p className="mt-1 text-xs text-violet-100/70">{weekLabel}</p>
          <Link to="/production-pool" className="mt-2 inline-block text-xs font-medium text-violet-300 transition hover:text-violet-200">
            Production Pool →
          </Link>
        </div>
      </div>

      {/* Analysis strip */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/15 to-slate-900/30 p-5 shadow-lg shadow-black/20">
          <p className="text-xs font-medium uppercase tracking-wider text-cyan-200/80">Top payout location</p>
          <p className="mt-2 text-lg font-semibold text-white">{topLocation?.name ?? '--'}</p>
          <p className="mt-1 text-sm tabular-nums text-cyan-100/80">{formatMoney(topLocation?.payout ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/15 to-slate-900/30 p-5 shadow-lg shadow-black/20">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-200/80">Average daily gross</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-white">{formatMoney(avgDailyGross)}</p>
          <p className="mt-1 text-sm tabular-nums text-emerald-100/80">7-day total: {formatMoney(totalDailyGross)}</p>
        </div>
        <div className="rounded-2xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/15 to-slate-900/30 p-5 shadow-lg shadow-black/20">
          <p className="text-xs font-medium uppercase tracking-wider text-fuchsia-200/80">Peak daily gross</p>
          <p className="mt-2 text-lg font-semibold text-white">{peakDay?.label ?? '--'}</p>
          <p className="mt-1 text-sm tabular-nums text-fuchsia-100/80">{formatMoney(peakDay?.gross ?? 0)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Weekly Payout by Location */}
        <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/20 backdrop-blur">
          <h2 className="mb-4 text-base font-semibold text-slate-100">Weekly payout by location</h2>
          <div className="min-h-[280px] flex-1">
            {payoutChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={payoutChartData}
                  margin={{ top: 12, right: 12, left: 0, bottom: 24 }}
                  barCategoryGap="20%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    interval={0}
                    angle={payoutChartData.length > 4 ? -25 : 0}
                    textAnchor={payoutChartData.length > 4 ? 'end' : 'middle'}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickFormatter={(v) => formatMoney(v)}
                    width={52}
                  />
                  <Tooltip
                    content={<ChartTooltip formatter={formatMoney} />}
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
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
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02]">
                <p className="text-center text-sm text-slate-400">
                  No payout data. Load from{' '}
                  <Link to="/weekly-payout" className="font-medium text-indigo-300 hover:text-indigo-200">Weekly Payout</Link>.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Daily gross tips */}
        <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/20 backdrop-blur">
          <h2 className="mb-4 text-base font-semibold text-slate-100">Daily gross tips</h2>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
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
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02]">
                <p className="text-center text-sm text-slate-400">
                  No data. Enter in{' '}
                  <Link to="/daily-tips" className="font-medium text-indigo-300 hover:text-indigo-200">Daily Tips</Link>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Location contribution */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/20 backdrop-blur">
        <h2 className="mb-4 text-base font-semibold text-slate-100">Location contribution</h2>
        <div className="space-y-3">
          {locationContribution.length > 0 ? (
            locationContribution.map((item) => (
              <div key={item.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-200">{item.name}</span>
                  <span className="tabular-nums text-slate-300">
                    {formatMoney(item.payout)} ({formatPercent(item.share)})
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400"
                    style={{ width: `${Math.max(item.share, 3)}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-slate-400">
              No location contribution data.
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/20 backdrop-blur">
        <h2 className="mb-4 text-base font-semibold text-slate-100">Quick links</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/daily-tips"
            className="rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-4 py-2.5 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/25"
          >
            Daily Tips
          </Link>
          <Link
            to="/weekly-payout"
            className="rounded-lg border border-amber-400/30 bg-amber-500/15 px-4 py-2.5 text-sm font-medium text-amber-200 transition hover:bg-amber-500/25"
          >
            Weekly Payout
          </Link>
          <Link
            to="/weekly-tardiness"
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/15"
          >
            Weekly Tardiness
          </Link>
          <Link
            to="/production-pool"
            className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-4 py-2.5 text-sm font-medium text-violet-200 transition hover:bg-violet-500/25"
          >
            Production Pool
          </Link>
          <Link
            to="/time-entries"
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/15"
          >
            Time Entries
          </Link>
        </div>
      </div>
    </div>
  );
}