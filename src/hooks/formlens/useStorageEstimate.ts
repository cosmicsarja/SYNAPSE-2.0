/**
 * Hook to query navigator.storage.estimate() — storage quota and usage.
 */
import { useState, useEffect } from 'react';

interface StorageInfo {
  usage: number;   // bytes used
  quota: number;   // bytes available
  usageMB: string;
  quotaMB: string;
  percent: number;
}

export function useStorageEstimate(): StorageInfo | null {
  const [info, setInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    navigator.storage.estimate().then((estimate) => {
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      setInfo({
        usage,
        quota,
        usageMB: (usage / 1024 / 1024).toFixed(1),
        quotaMB: (quota / 1024 / 1024).toFixed(0),
        percent: quota > 0 ? Math.round((usage / quota) * 100) : 0,
      });
    }).catch(() => {/* storage.estimate not available */});
  }, []);

  return info;
}

