import { Outlet, NavLink } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/locations', label: 'Locations' },
  { to: '/employees', label: 'Employees' },
  { to: '/daily-tips', label: 'Daily Tips' },
  { to: '/time-entries', label: 'Time Entries' },
  { to: '/manual-working', label: 'Manual Working' },
  { to: '/weekly-payout', label: 'Weekly Payout' },
  { to: '/audit', label: 'Audit' },
];

export default function Layout() {
  const { locations, selectedLocationId, setSelectedLocationId, locationsLoading } = useApp();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight text-indigo-600 dark:text-indigo-400">
            ConnectTeam
          </h1>
          <nav className="flex flex-wrap items-center gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        {!locationsLoading && locations.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-2 dark:border-slate-700 sm:px-6">
            <label className="mr-2 text-sm text-slate-500 dark:text-slate-400">Location:</label>
            <select
              value={selectedLocationId || ''}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="">All</option>
              {locations.map((loc) => (
                <option key={loc._id} value={loc._id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
