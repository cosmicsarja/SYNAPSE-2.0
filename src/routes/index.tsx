import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { getSetting } from '@/db';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'FormLens – Offline Form Scanner' },
      { name: 'description', content: 'Offline-first PWA for scanning Kannada and English government forms with on-device AI.' },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    // Route based on setup state
    getSetting<boolean>('setup_complete', false).then((done) => {
      if (done) {
        void navigate({ to: '/scan', replace: true });
      } else {
        void navigate({ to: '/setup', replace: true });
      }
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-50 to-white">
      <div className="text-center space-y-2">
        <div className="text-3xl font-bold text-primary">FormLens</div>
        <div className="text-sm text-muted-foreground">ಫಾರ್ಮ್‌ಲೆನ್ಸ್</div>
        <div className="mt-4 text-xs text-muted-foreground">Loading…</div>
      </div>
    </div>
  );
}
