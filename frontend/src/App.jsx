import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DailyTips from './pages/DailyTips';
import TimeEntries from './pages/TimeEntries';
import WeeklyPayout from './pages/WeeklyPayout';
import WeeklyTardiness from './pages/WeeklyTardiness';
import ProductionPool from './pages/ProductionPool';
import CreateSupervisor from './pages/CreateSupervisor';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              style: { background: '#1e293b', color: '#f1f5f9' },
            }}
          />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="time-entries" element={<TimeEntries />} />
              <Route path="daily-tips" element={<DailyTips />} />
              <Route path="weekly-payout" element={<WeeklyPayout />} />
              <Route path="weekly-tardiness" element={<WeeklyTardiness />} />
              <Route path="production-pool" element={<ProductionPool />} />
              <Route path="supervisors" element={<CreateSupervisor />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
