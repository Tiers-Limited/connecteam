import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { FiUser, FiLogOut, FiUsers, FiSettings } from 'react-icons/fi';

// All navigation items
const navItems = [
  { to: '/', label: 'Dashboard' },
  // { to: '/daily-tips', label: 'Daily Tips' },
  { to: '/production-pool', label: 'Production Pool' },
  { to: '/weekly-payout', label: 'Weekly Payout Workflow' },
  { to: '/payout-reports', label: 'Reports' },
  { to: '/daily-tips-history', label: 'Tip History' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const isSupervisor = user?.role === 'supervisor';
  const location = useLocation();

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

  // Filter navigation items based on user role
  const getFilteredNavItems = () => {
    if (isAdmin) {
      return navItems; // Admin sees all items
    }
    // Supervisor sees all items except 'daily-tips-history'
    return navItems.filter(item => item.to !== '/daily-tips-history');
  };

  const filteredNavItems = getFilteredNavItems();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/85 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-br from-indigo-300 to-fuchsia-400 shadow-[0_0_14px_rgba(129,140,248,0.8)]" />
            <h1 className="text-xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 via-violet-200 to-fuchsia-300">
              Corvia Tips Dashboard
            </h1>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            {/* Render filtered navigation items based on role */}
            {filteredNavItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-200'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
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
                className="flex items-center justify-center rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white"
                aria-expanded={dropdownOpen}
                aria-haspopup="true"
                aria-label="User menu"
              >
                <FiUser className="h-5 w-5" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-white/10 bg-slate-900 py-1 shadow-lg">
                  <div className="border-b border-white/10 px-4 py-3">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {user?.email}
                    </p>
                    {user?.username && (
                      <p className="truncate text-xs text-slate-400">
                        {user.username}
                      </p>
                    )}
                  </div>
                  {/* Only admins can see the Supervisors link */}
                  {isAdmin && (
                    <Link
                      to="/supervisors"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
                    >
                      <FiUsers className="h-4 w-4" />
                      Supervisors
                    </Link>
                  )}
                  <Link
                    to="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
                  >
                    <FiSettings className="h-4 w-4" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
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
        <Outlet />
      </main>
    </div>
  );
}