/**
 * Offline status bar — shown at top of every screen.
 */
import { useOfflineStatus } from '@/hooks/formlens/useOfflineStatus';
import { Wifi, WifiOff } from 'lucide-react';

export function OfflineStatusBar() {
  const isOnline = useOfflineStatus();

  if (isOnline) return null; // hide when online

  return (
    <div className="flex items-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-white">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Offline mode (data saved on this device)</span>
    </div>
  );
}

export function OnlineIndicator() {
  const isOnline = useOfflineStatus();
  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${isOnline ? 'text-green-600' : 'text-amber-600'}`}>
      {isOnline
        ? <><Wifi className="h-3.5 w-3.5" /><span>Online</span></>
        : <><WifiOff className="h-3.5 w-3.5" /><span>Offline</span></>
      }
    </div>
  );
}

