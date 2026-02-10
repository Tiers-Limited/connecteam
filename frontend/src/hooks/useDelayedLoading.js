import { useState, useEffect } from 'react';
import { LOADING_DELAY_MS } from '../utils/constants';

/**
 * Returns true only after LOADING_DELAY_MS (0.5s) while still loading.
 * Use to show skeleton only after a short delay to avoid flash for fast requests.
 */
export function useDelayedLoading(isLoading) {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }
    const t = setTimeout(() => setShowLoading(true), LOADING_DELAY_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  return showLoading;
}
