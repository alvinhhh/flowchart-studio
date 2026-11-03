import type { Metadata } from 'next';
import SharedDiagram from '@/components/shared-diagram';

export const metadata: Metadata = {
  title: 'Shared diagram',
  description: 'Open a shared flowchart snapshot.',
  robots: { index: false, follow: false, noarchive: true },
  referrer: 'no-referrer',
  openGraph: { title: 'Shared diagram', description: 'Open a shared flowchart snapshot.' },
  twitter: { title: 'Shared diagram', description: 'Open a shared flowchart snapshot.' },
};

export default function SharePage() { return <SharedDiagram />; }
