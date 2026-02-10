import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import DailyTips from './pages/DailyTips';
import TimeEntries from './pages/TimeEntries';
import WeeklyPayout from './pages/WeeklyPayout';

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
            <Route path="time-entries" element={<TimeEntries />} />
            <Route path="daily-tips" element={<DailyTips />} />
            <Route path="weekly-payout" element={<WeeklyPayout />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
