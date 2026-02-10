import SkeletonBox from './SkeletonBox';

export default function SkeletonForm({ fields = 4 }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i}>
          <SkeletonBox className="mb-2 h-4 w-24" />
          <SkeletonBox className="h-10 w-full" />
        </div>
      ))}
      <div className="flex gap-3 pt-2">
        <SkeletonBox className="h-10 w-24" />
        <SkeletonBox className="h-10 w-24" />
      </div>
    </div>
  );
}
