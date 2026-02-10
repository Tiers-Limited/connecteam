import SkeletonBox from './SkeletonBox';
import SkeletonTable from './SkeletonTable';

export default function SkeletonPage({ variant = 'table' }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonBox className="h-8 w-48" />
        <SkeletonBox className="h-10 w-32" />
      </div>
      {variant === 'table' && <SkeletonTable rows={8} cols={5} />}
      {variant === 'cards' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonBox key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}
      {variant === 'form' && (
        <div className="max-w-md">
          <SkeletonBox className="mb-6 h-6 w-40" />
          <SkeletonBox className="h-64 w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
