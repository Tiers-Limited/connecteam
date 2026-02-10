import SkeletonBox from './SkeletonBox';

export default function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
      <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBox key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonBox key={c} className="h-5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
