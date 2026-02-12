import { createContext, useContext, useState, useCallback } from 'react';
import { getLocations } from '../services/locationService';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [selectedLocationId, setSelectedLocationId] = useState(null);

  const refreshLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
      const list = await getLocations(false);
      setLocations(list);
      if (list.length && !selectedLocationId) setSelectedLocationId(list[0]._id);
    } catch (e) {
      // API errors logged in api.js
    } finally {
      setLocationsLoading(false);
    }
  }, [selectedLocationId]);

  const value = {
    locations,
    locationsLoading,
    refreshLocations,
    selectedLocationId,
    setSelectedLocationId,
    selectedLocation: locations.find((l) => l._id === selectedLocationId) || null,
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
