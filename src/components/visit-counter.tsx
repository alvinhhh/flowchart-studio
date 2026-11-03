'use client';

import { useEffect } from 'react';
import { diagramMetrics } from '@/lib/repository';

export default function VisitCounter() {
  useEffect(() => {
    const visit = () => { if (document.visibilityState === 'visible') void diagramMetrics.visit(); };
    const online = () => { void diagramMetrics.visit(); };
    visit();
    document.addEventListener('visibilitychange', visit);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', visit);
      window.removeEventListener('online', online);
    };
  }, []);
  return null;
}
