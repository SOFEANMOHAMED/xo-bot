import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackMetaPageView } from '../utils/metaPixel';

/**
 * Fires Meta Pixel PageView on client-side route changes.
 * Skips the first render (already tracked by /meta-pixel.js).
 */
export default function MetaPixelPageTracker() {
  const location = useLocation();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    trackMetaPageView();
  }, [location.pathname, location.search]);

  return null;
}
