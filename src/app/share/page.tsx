import type { Metadata } from 'next';
import SharedDiagram from '@/components/shared-diagram';
import { SOCIAL_IMAGE } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Shared diagram',
  description: 'Open a shared flowchart snapshot.',
  robots: { index: false, follow: false, noarchive: true },
  referrer: 'no-referrer',
  openGraph: { title: 'Shared diagram', description: 'Open a shared flowchart snapshot.', images: [SOCIAL_IMAGE] },
  twitter: { card: 'summary_large_image', title: 'Shared diagram', description: 'Open a shared flowchart snapshot.', images: [SOCIAL_IMAGE] },
};

export default function SharePage() { return <SharedDiagram />; }
