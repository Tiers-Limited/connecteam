export default function Card({ title, children, className = '' }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/50 ${className}`}
    >
      {title && (
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
