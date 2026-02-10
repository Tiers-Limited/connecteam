import SkeletonBox from './SkeletonBox';

export default function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
      <SkeletonBox className="mb-4 h-6 w-2/3" />
      <SkeletonBox className="mb-2 h-4 w-full" />
      <SkeletonBox className="mb-2 h-4 w-5/6" />
      <SkeletonBox className="h-4 w-4/6" />
    </div>
  );
}
