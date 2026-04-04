export default function Card({ title, children, className = '' }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm ${className}`}
    >
      {title && (
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
