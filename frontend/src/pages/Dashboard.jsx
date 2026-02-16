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
import Card from '../components/ui/Card';
import { formatDate } from '../utils/dateUtils';

const CACHE_TTL_MS = 60 * 1000; // 1 minute
let cachedSummary = null;
let cachedAt = 0;

function formatMoney(n) {
  return '$' + (Number(n) ?? 0).toFixed(2);
}

const chartTheme = {
  grid: 'stroke-slate-200/60 dark:stroke-slate-600/60',
  tick: 'text-slate-500 dark:text-slate-400 text-xs',
  tooltip: 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg px-3 py-2 text-sm',
};

function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  const displayLabel = labelFormatter ? labelFormatter(label, payload) : label;
  return (
    <div className={chartTheme.tooltip}>
      {displayLabel && <div className="font-medium text-slate-700 dark:text-slate-200 mb-0.5">{displayLabel}</div>}
      <div className="text-slate-600 dark:text-slate-300">{formatter ? formatter(value) : value}</div>
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

  if (loading && !summary) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const payoutByLocation = summary?.payoutByLocation ?? [];
  const dailyTipsLast7 = summary?.dailyTipsLast7 ?? [];
  const weekLabel = summary?.currentWeekStart
    ? `${formatDate(summary.currentWeekStart)} week`
    : 'This week';

  const payoutChartData = payoutByLocation.map((l) => ({ name: l.locationName, payout: l.totalPayable }));
  const dailyChartData = dailyTipsLast7.map((d) => ({
    date: d.date,
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    gross: d.totalGross,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tips, payouts, and production pool. Load data from Weekly Payout and Production Pool for charts.
          </p>
        </div>
        {refreshing && (
          <span className="text-xs text-slate-500 dark:text-slate-400">Updating…</span>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="overflow-hidden border-0 bg-linear-to-br from-indigo-500/10 to-indigo-600/5 dark:from-indigo-500/15 dark:to-indigo-600/10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Locations</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
                {summary?.locationsCount ?? locations.length ?? 0}
              </p>
              <Link to="/time-entries" className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Time Entries →
              </Link>
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden border-0 bg-linear-to-br from-emerald-500/10 to-emerald-600/5 dark:from-emerald-500/15 dark:to-emerald-600/10">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Employees</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
              {summary?.employeesCount ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active (all locations)</p>
          </div>
        </Card>
        <Card className="overflow-hidden border-0 bg-linear-to-br from-amber-500/10 to-amber-600/5 dark:from-amber-500/15 dark:to-amber-600/10">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Front staff payout</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
              {formatMoney(summary?.totalPayoutThisWeek ?? 0)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{weekLabel}</p>
            <Link to="/weekly-payout" className="mt-2 inline-block text-xs font-medium text-amber-600 hover:underline dark:text-amber-400">
              Weekly Payout →
            </Link>
          </div>
        </Card>
        <Card className="overflow-hidden border-0 bg-linear-to-br from-violet-500/10 to-violet-600/5 dark:from-violet-500/15 dark:to-violet-600/10">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Production pool</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
              {formatMoney(summary?.productionTotal ?? 0)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{weekLabel}</p>
            <Link to="/production-pool" className="mt-2 inline-block text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
              Production Pool →
            </Link>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Weekly Payout by Location */}
        <Card title="Weekly payout by location" className="flex flex-col">
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Current week tips payable per location.
          </p>
          <div className="min-h-[280px] flex-1">
            {payoutChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={payoutChartData}
                  margin={{ top: 12, right: 12, left: 0, bottom: 24 }}
                  barCategoryGap="20%"
                >
                  <CartesianGrid strokeDasharray="3 3" className={chartTheme.grid} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    className={chartTheme.tick}
                    interval={0}
                    angle={payoutChartData.length > 4 ? -25 : 0}
                    textAnchor={payoutChartData.length > 4 ? 'end' : 'middle'}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    tickFormatter={(v) => formatMoney(v)}
                    className={chartTheme.tick}
                    width={52}
                  />
                  <Tooltip
                    content={<ChartTooltip formatter={formatMoney} />}
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
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
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 dark:border-slate-600 dark:bg-slate-800/30">
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  No payout data. Load from <Link to="/weekly-payout" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Weekly Payout</Link>.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Daily gross tips – last 7 days */}
        <Card title="Daily gross tips (last 7 days)" className="flex flex-col">
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            AM + PM gross tips across all locations.
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
                  <CartesianGrid strokeDasharray="3 3" className={chartTheme.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    className={chartTheme.tick}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    tickFormatter={(v) => formatMoney(v)}
                    className={chartTheme.tick}
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
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 dark:border-slate-600 dark:bg-slate-800/30">
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  No data. Enter in <Link to="/daily-tips" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Daily Tips</Link>.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Quick links */}
      <Card title="Quick links">
        <div className="flex flex-wrap gap-3">
          <Link
            to="/daily-tips"
            className="rounded-lg bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
          >
            Daily Tips
          </Link>
          <Link
            to="/weekly-payout"
            className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
          >
            Weekly Payout
          </Link>
          <Link
            to="/weekly-tardiness"
            className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          >
            Weekly Tardiness
          </Link>
          <Link
            to="/production-pool"
            className="rounded-lg bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50"
          >
            Production Pool
          </Link>
          <Link
            to="/time-entries"
            className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          >
            Time Entries
          </Link>
        </div>
      </Card>
    </div>
  );
}
