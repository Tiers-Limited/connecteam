import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getLocations } from '../services/locationService';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [timeEntriesCache, setTimeEntriesCache] = useState({ locationId: null, startDate: null, endDate: null, entries: [] });
  const [dailyTipsCache, setDailyTipsCache] = useState({ locationId: null, date: null, form: { amGrossTips: '', pmGrossTips: '' }, calculation: null, calculationError: null });

  const refreshLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
      const list = await getLocations(false);
      setLocations(list);
      setSelectedLocationId((prev) => (list.length && !prev ? list[0]._id : prev));
    } catch (e) {
      // API errors logged in api.js
    } finally {
      setLocationsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshLocations();
  }, [refreshLocations]);

  const value = {
    locations,
    locationsLoading,
    refreshLocations,
    selectedLocationId,
    setSelectedLocationId,
    selectedLocation: locations.find((l) => l._id === selectedLocationId) || null,
    timeEntriesCache,
    setTimeEntriesCache,
    dailyTipsCache,
    setDailyTipsCache,
    apiBase: '/api',
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export const useAppContext = useApp;
