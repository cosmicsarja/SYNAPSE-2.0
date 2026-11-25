/**
 * Confidence badge: green ≥85%, amber 60–85%, red <60%.
 */
import { cn } from '@/lib/utils';

interface Props {
  confidence: number; // 0–1
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: Props) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 85 ? 'bg-green-100 text-green-800 border-green-200' :
    pct >= 60 ? 'bg-amber-100 text-amber-800 border-amber-200' :
                'bg-red-100 text-red-800 border-red-200';

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', color, className)}>
      {pct}%
    </span>
  );
}

export function confidenceColor(confidence: number): string {
  const pct = confidence * 100;
  if (pct >= 85) return 'border-green-300 bg-green-50';
  if (pct >= 60) return 'border-amber-300 bg-amber-50';
  return 'border-red-300 bg-red-50';
}

