export default function SkeletonBox({ className = '', ...props }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700 ${className}`}
      {...props}
    />
  );
}
