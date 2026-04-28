import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { FiActivity, FiArrowRight, FiBarChart2, FiDollarSign, FiLayers, FiMapPin, FiUsers } from 'react-icons/fi';
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
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-sm shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
      {displayLabel && <div className="mb-0.5 font-medium text-slate-700 dark:text-slate-200">{displayLabel}</div>}
      <div className="text-slate-600 dark:text-slate-300">{formatter ? formatter(value) : value}</div>
    </div>
  );
}

function MultiSeriesTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const displayLabel = labelFormatter ? labelFormatter(label, payload) : label;
  const rows = payload
    .filter((p) => p && typeof p.value === 'number' && p.value > 0)
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-sm shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
      {displayLabel && <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">{displayLabel}</div>}
      <div className="space-y-1">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div key={row.name} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color || '#94a3b8' }} />
                {row.name}
              </span>
              <span className="tabular-nums text-slate-800 dark:text-slate-100">{formatMoney(row.value)} gross tips</span>
            </div>
          ))
        ) : (
          <div className="text-slate-600 dark:text-slate-300">No gross tips</div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint, tone = 'indigo', actionHref, actionLabel }) {
  const toneStyles = {
    indigo: {
      ring: 'border-indigo-200 dark:border-indigo-300/20',
      panel: 'from-indigo-100 via-indigo-50 to-transparent dark:from-indigo-500/20 dark:via-indigo-500/8 dark:to-transparent',
      icon: 'text-indigo-800 bg-indigo-100 dark:text-indigo-200 dark:bg-indigo-500/20',
      text: 'text-indigo-700/80 dark:text-indigo-100/80',
      action: 'text-indigo-700 hover:text-indigo-800 dark:text-indigo-200 dark:hover:text-indigo-100',
    },
    emerald: {
      ring: 'border-emerald-200 dark:border-emerald-300/20',
      panel: 'from-emerald-100 via-emerald-50 to-transparent dark:from-emerald-500/20 dark:via-emerald-500/8 dark:to-transparent',
      icon: 'text-emerald-800 bg-emerald-100 dark:text-emerald-200 dark:bg-emerald-500/20',
      text: 'text-emerald-700/80 dark:text-emerald-100/80',
      action: 'text-emerald-700 hover:text-emerald-800 dark:text-emerald-200 dark:hover:text-emerald-100',
    },
    amber: {
      ring: 'border-amber-200 dark:border-amber-300/20',
      panel: 'from-amber-100 via-amber-50 to-transparent dark:from-amber-500/20 dark:via-amber-500/8 dark:to-transparent',
      icon: 'text-amber-800 bg-amber-100 dark:text-amber-200 dark:bg-amber-500/20',
      text: 'text-amber-700/80 dark:text-amber-100/80',
      action: 'text-amber-700 hover:text-amber-800 dark:text-amber-200 dark:hover:text-amber-100',
    },
    violet: {
      ring: 'border-violet-200 dark:border-violet-300/20',
      panel: 'from-violet-100 via-violet-50 to-transparent dark:from-violet-500/20 dark:via-violet-500/8 dark:to-transparent',
      icon: 'text-violet-800 bg-violet-100 dark:text-violet-200 dark:bg-violet-500/20',
      text: 'text-violet-700/80 dark:text-violet-100/80',
      action: 'text-violet-700 hover:text-violet-800 dark:text-violet-200 dark:hover:text-violet-100',
    },
  };

  const selected = toneStyles[tone] ?? toneStyles.indigo;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-md backdrop-blur dark:bg-slate-900/70 dark:shadow-[0_12px_28px_rgba(2,6,23,0.45)] ${selected.ring}`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${selected.panel}`} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
          </div>
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${selected.icon}`}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
        {hint && <p className={`mt-1.5 text-xs ${selected.text}`}>{hint}</p>}
        {actionHref && actionLabel && (
          <Link to={actionHref} className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold transition ${selected.action}`}>
            {actionLabel}
            <FiArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

function InsightCard({ label, value, detail, tone = 'slate' }) {
  const tones = {
    cyan: {
      ring: 'border-cyan-200 dark:border-cyan-300/20',
      panel: 'from-cyan-100 via-cyan-50 to-transparent dark:from-cyan-500/18 dark:via-cyan-500/8 dark:to-transparent',
      text: 'text-cyan-800 dark:text-cyan-100/80',
    },
    emerald: {
      ring: 'border-emerald-200 dark:border-emerald-300/20',
      panel: 'from-emerald-100 via-emerald-50 to-transparent dark:from-emerald-500/18 dark:via-emerald-500/8 dark:to-transparent',
      text: 'text-emerald-800 dark:text-emerald-100/80',
    },
    fuchsia: {
      ring: 'border-fuchsia-200 dark:border-fuchsia-300/20',
      panel: 'from-fuchsia-100 via-fuchsia-50 to-transparent dark:from-fuchsia-500/18 dark:via-fuchsia-500/8 dark:to-transparent',
      text: 'text-fuchsia-800 dark:text-fuchsia-100/80',
    },
    slate: {
      ring: 'border-slate-200 dark:border-white/12',
      panel: 'from-white/10 via-white/[0.04] to-transparent',
      text: 'text-slate-700 dark:text-slate-300',
    },
  };
  const selected = tones[tone] ?? tones.slate;

  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-md dark:bg-slate-900/60 dark:shadow-[0_10px_24px_rgba(2,6,23,0.35)] ${selected.ring}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${selected.panel}`} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-[0.11em] text-slate-600 dark:text-slate-300">{label}</p>
        <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{value}</p>
        {detail && <p className={`mt-1 text-sm ${selected.text}`}>{detail}</p>}
      </div>
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
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-black/10 backdrop-blur dark:border-white/10 dark:bg-white/[0.03] dark:shadow-black/20">
            <SkeletonBox className="mb-1 h-6 w-56 rounded-md" />
            <div className="flex h-[280px] items-end justify-around gap-2 px-2 pb-8 pt-4">
              {[40, 65, 45, 80, 55, 70].map((h, j) => (
                <SkeletonBox key={j} className="w-full flex-1 rounded-t-md" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-black/10 backdrop-blur dark:border-white/10 dark:bg-white/[0.03] dark:shadow-black/20">
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
  const hasFreshCache = cachedSummary && Date.now() - cachedAt < CACHE_TTL_MS;
  const [summary, setSummary] = useState(() => {
    if (cachedSummary && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSummary;
    return null;
  });
  const [loading, setLoading] = useState(!hasFreshCache);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const hasCache = cachedSummary && Date.now() - cachedAt < CACHE_TTL_MS;
      if (hasCache) {
        setSummary(cachedSummary);
        setLoading(false);
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        // Keep dashboard fetch independent; location refresh failures should not
        // leave dashboard stuck with empty data.
        await refreshLocations().catch(() => {});
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

  const payoutByName = new Map(
    payoutByLocation.map((l) => [
      String(l?.locationName || '').trim(),
      Number(l?.totalPayable) || 0,
    ]),
  );
  const dailyChartData = dailyTipsLast7.map((d) => ({
    date: d.date,
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    gross: d.totalGross,
    byLocation: d.byLocation || {},
  }));
  const locationSeriesInDaily = Array.from(
    dailyChartData.reduce((set, row) => {
      Object.keys(row.byLocation || {}).forEach((name) => set.add(name));
      return set;
    }, new Set())
  );
  const allLocationNames = Array.from(
    new Set([
      ...((locations || []).map((l) => String(l?.name || '').trim()).filter(Boolean)),
      ...Array.from(payoutByName.keys()).filter(Boolean),
      ...locationSeriesInDaily.filter(Boolean),
    ]),
  );
  const payoutChartData = allLocationNames.map((name) => ({
    name,
    payout: payoutByName.get(name) ?? 0,
  }));
  const locationSeries = allLocationNames.filter((name) =>
    locationSeriesInDaily.includes(name),
  );
  const dailySeriesData = dailyChartData.map((row) => {
    const item = { date: row.date, label: row.label, gross: row.gross };
    locationSeries.forEach((name) => {
      item[name] = Number(row.byLocation?.[name] || 0);
    });
    return item;
  });
  const seriesPalette = [
    'rgb(16 185 129)',
    'rgb(99 102 241)',
    'rgb(244 114 182)',
    'rgb(56 189 248)',
    'rgb(250 204 21)',
    'rgb(168 85 247)',
  ];
  const locationColorMap = new Map(
    allLocationNames.map((name, idx) => [name, seriesPalette[idx % seriesPalette.length]]),
  );
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Overview</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Dashboard</h1>
        </div>
        {refreshing && <span className="text-xs text-slate-500 dark:text-slate-400">Updating…</span>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={FiMapPin}
          label="Locations"
          value={summary?.locationsCount ?? locations.length ?? 0}
          tone="indigo"
        />
        <StatCard
          icon={FiUsers}
          label="Employees"
          value={summary?.employeesCount ?? 0}
          tone="emerald"
        />
        <StatCard
          icon={FiDollarSign}
          label="Front staff payout"
          value={formatMoney(summary?.totalPayoutThisWeek ?? 0)}
          hint={weekLabel}
          tone="amber"
          actionHref="/weekly-payout"
          actionLabel="Weekly Payout"
        />
        <StatCard
          icon={FiLayers}
          label="Production pool"
          value={formatMoney(summary?.productionTotal ?? 0)}
          hint={weekLabel}
          tone="violet"
          actionHref="/production-pool"
          actionLabel="Production Pool"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <InsightCard
          label="Top payout location"
          value={topLocation?.name ?? '--'}
          detail={formatMoney(topLocation?.payout ?? 0)}
          tone="cyan"
        />
        <InsightCard
          label="Average daily gross"
          value={formatMoney(avgDailyGross)}
          detail={`7-day total: ${formatMoney(totalDailyGross)}`}
          tone="emerald"
        />
        <InsightCard
          label="Peak daily gross"
          value={peakDay?.label ?? '--'}
          detail={formatMoney(peakDay?.gross ?? 0)}
          tone="fuchsia"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-md backdrop-blur dark:border-white/12 dark:bg-slate-900/65 dark:shadow-[0_12px_28px_rgba(2,6,23,0.45)]">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200">
              <FiBarChart2 className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Weekly payout by location</h2>
          </div>
          <div className="min-h-[280px] flex-1">
            {payoutChartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Tooltip
                      content={<ChartTooltip formatter={formatMoney} />}
                    />
                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      wrapperStyle={{ paddingTop: 8 }}
                      formatter={(value) => <span className="text-xs text-slate-600 dark:text-slate-300">{value}</span>}
                    />
                    <Pie
                      data={payoutChartData}
                      dataKey="payout"
                      nameKey="name"
                      cx="50%"
                      cy="46%"
                      innerRadius={56}
                      outerRadius={92}
                      paddingAngle={2}
                      isAnimationActive={!refreshing}
                    >
                      {payoutChartData.map((_, idx) => (
                        <Cell
                          key={`payoutSlice-${idx}`}
                          fill={locationColorMap.get(payoutChartData[idx]?.name) || seriesPalette[idx % seriesPalette.length]}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {payoutChartData.map((item, idx) => {
                    const share = totalPayout ? ((Number(item.payout) || 0) / totalPayout) * 100 : 0;
                    const color = locationColorMap.get(item.name) || seriesPalette[idx % seriesPalette.length];
                    return (
                      <div key={item.name} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-white/10 dark:bg-white/[0.02]">
                        <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                          {item.name}
                        </span>
                        <span className="tabular-nums text-slate-600 dark:text-slate-300">{share.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:border-white/15 dark:bg-white/[0.02]">
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  No payout data. Load from{' '}
                  <Link to="/weekly-payout" className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200">Weekly Payout</Link>.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-md backdrop-blur dark:border-white/12 dark:bg-slate-900/65 dark:shadow-[0_12px_28px_rgba(2,6,23,0.45)]">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
              <FiActivity className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Daily gross tips</h2>
          </div>
          <div className="min-h-[280px] flex-1">
            {dailySeriesData.length > 0 && locationSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={dailySeriesData}
                  margin={{ top: 12, right: 12, left: 0, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
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
                      <MultiSeriesTooltip
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.date ? formatDate(payload[0].payload.date) : ''
                        }
                      />
                    }
                    cursor={{ stroke: 'rgb(148 163 184)', strokeDasharray: '4 4', strokeWidth: 1 }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="left"
                    wrapperStyle={{ paddingBottom: 8 }}
                    formatter={(value) => <span className="text-xs text-slate-600 dark:text-slate-300">{value}</span>}
                  />
                  {locationSeries.map((series, idx) => {
                    const color = locationColorMap.get(series) || seriesPalette[idx % seriesPalette.length];
                    return (
                      <Area
                        key={series}
                        type="monotone"
                        dataKey={series}
                        name={series}
                        stroke={color}
                        strokeWidth={2}
                        fill={color}
                        fillOpacity={0.1}
                        dot={{ fill: color, strokeWidth: 0, r: 3 }}
                        activeDot={{ r: 5, fill: 'white', stroke: color, strokeWidth: 2 }}
                        isAnimationActive={!refreshing}
                      />
                    );
                  })}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:border-white/15 dark:bg-white/[0.02]">
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  No data. Enter in{' '}
                  <Link to="/daily-tips" className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200">Daily Tips</Link>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-md backdrop-blur dark:border-white/12 dark:bg-slate-900/65 dark:shadow-[0_12px_28px_rgba(2,6,23,0.45)]">
          <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Location contribution</h2>
          <div className="space-y-3">
            {locationContribution.length > 0 ? (
              locationContribution.map((item) => (
                <div key={item.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{item.name}</span>
                    <span className="tabular-nums text-slate-600 dark:text-slate-300">
                      {formatMoney(item.payout)} ({formatPercent(item.share)})
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400"
                      style={{ width: `${Math.max(item.share, 3)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.02] dark:text-slate-400">
                No location contribution data.
              </div>
            )}
          </div>
        </div>
      </div>
  );
}