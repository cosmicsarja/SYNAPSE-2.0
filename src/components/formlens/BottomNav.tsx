/**
 * Bottom navigation bar for the main app screens.
 */
import { Link, useMatchRoute } from '@tanstack/react-router';
import { Camera, FileText, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/scan' as const, label: 'Scan', icon: Camera },
  { to: '/forms' as const, label: 'Forms', icon: FileText },
  { to: '/settings' as const, label: 'Settings', icon: Settings },
];

export function BottomNav() {
  const matchRoute = useMatchRoute();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background">
      <div className="flex">
        {navItems.map(({ to, label, icon: Icon }) => {
          const active = !!matchRoute({ to });
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-3 text-xs font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

