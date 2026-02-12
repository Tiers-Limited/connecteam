import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Locations from './pages/Locations';
import Employees from './pages/Employees';
import DailyTips from './pages/DailyTips';
import TimeEntries from './pages/TimeEntries';
import ManualWorking from './pages/ManualWorking';
import WeeklyPayout from './pages/WeeklyPayout';
import Audit from './pages/Audit';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: { background: '#1e293b', color: '#f1f5f9' },
          }}
        />
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="locations" element={<Locations />} />
            <Route path="employees" element={<Employees />} />
            <Route path="daily-tips" element={<DailyTips />} />
            <Route path="time-entries" element={<TimeEntries />} />
            <Route path="manual-working" element={<ManualWorking />} />
            <Route path="weekly-payout" element={<WeeklyPayout />} />
            <Route path="audit" element={<Audit />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
