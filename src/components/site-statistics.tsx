'use client';

import { useEffect, useState } from 'react';

type Statistics = { startedAt: string; visitors: number; chartsCreated: number; chartsShared: number };

function readStatistics(value: unknown): Statistics {
  if (!value || typeof value !== 'object') throw new Error('Statistics unavailable');
  const data = value as Record<string, unknown>;
  if (typeof data.startedAt !== 'string' || !Number.isFinite(Date.parse(data.startedAt))
    || !['visitors', 'chartsCreated', 'chartsShared'].every(key => Number.isSafeInteger(data[key]) && Number(data[key]) >= 0)) {
    throw new Error('Statistics unavailable');
  }
  return data as Statistics;
}

export default function SiteStatistics() {
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/stats', {
          credentials: 'omit', referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        });
        if (!response.ok) throw new Error('Statistics unavailable');
        const result = readStatistics(await response.json());
        if (active) { setStatistics(result); setUnavailable(false); }
      } catch {
        if (active) setUnavailable(true);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  const number = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('en-US');
  return <section className="site-statistics" aria-label="Site statistics">
    <dl className="site-statistics-grid">
      <div><dt>Visitors</dt><dd>{number(statistics?.visitors)}</dd></div>
      <div><dt>Charts created</dt><dd>{number(statistics?.chartsCreated)}</dd></div>
      <div><dt>Charts shared</dt><dd>{number(statistics?.chartsShared)}</dd></div>
      <div><dt>Uptime</dt><dd>99.99<span>%</span></dd></div>
    </dl>
    <p className="site-statistics-note">
      {unavailable ? (statistics ? 'Counts temporarily unavailable; showing the last update. ' : 'Counts temporarily unavailable. ') : statistics ? `All-time counts since ${new Date(statistics.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}. ` : 'All-time counts. '}
      <a href="/privacy#site-statistics">How counts work</a>
    </p>
  </section>;
}
