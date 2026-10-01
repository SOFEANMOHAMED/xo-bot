import React, { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import apiService from '../services/api';
import { PATHS } from '../routes/paths';

const TrackedLinkRedirect: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [destination, setDestination] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setMissing(true);
      return;
    }
    (async () => {
      try {
        const resolved = await apiService.resolveAcquisitionLink(code);
        if (!cancelled) setDestination(resolved.destination || PATHS.SIGNUP);
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (missing) {
    return <Navigate to={PATHS.SIGNUP} replace />;
  }

  if (destination) {
    return <Navigate to={destination} replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
      <p>جاري فتح الرابط…</p>
    </div>
  );
};

export default TrackedLinkRedirect;
