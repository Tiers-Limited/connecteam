import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { FiUser, FiLogOut, FiUsers, FiSettings } from 'react-icons/fi';

const adminNavItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/daily-tips', label: 'Daily Tips' },
  { to: '/production-pool', label: 'Production Pool' },
  { to: '/weekly-payout', label: 'Weekly Payout' },
  { to: '/weekly-tardiness', label: 'Weekly Tardiness' },
  { to: '/daily-tips-history', label: 'Tip History' },
];

const supervisorNavItems = [
  { to: '/daily-tips', label: 'Daily Tips' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const isSupervisor = user?.role === 'supervisor';
  const navItems = isAdmin ? adminNavItems : supervisorNavItems;
  const location = useLocation();
  const supervisorAllowedPaths = ['/daily-tips', '/settings'];
  const shouldRedirectSupervisor = isSupervisor && !supervisorAllowedPaths.includes(location.pathname);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [dropdownOpen]);

  async function handleLogout() {
    setDropdownOpen(false);
    await logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight text-indigo-600">
            Corvia Tips Dashboard
          </h1>
          <nav className="flex flex-wrap items-center gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}

            <div className="relative ml-2" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex items-center justify-center rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-expanded={dropdownOpen}
                aria-haspopup="true"
                aria-label="User menu"
              >
                <FiUser className="h-5 w-5" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {user?.email}
                    </p>
                    {user?.username && (
                      <p className="truncate text-xs text-slate-500">
                        {user.username}
                      </p>
                    )}
                  </div>
                  {isAdmin && (
                    <Link
                      to="/supervisors"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <FiUsers className="h-4 w-4" />
                      Supervisors
                    </Link>
                  )}
                  <Link
                    to="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <FiSettings className="h-4 w-4" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <FiLogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {shouldRedirectSupervisor ? (
          <Navigate to="/daily-tips" replace />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}