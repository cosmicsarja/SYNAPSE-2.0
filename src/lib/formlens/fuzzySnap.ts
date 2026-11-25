/**
 * Fuzzy locality snap using Fuse.js.
 * Matches district / taluk / village names from the Karnataka localities dictionary
 * in both English and Kannada.
 */
import Fuse from 'fuse.js';
import { hasKannada } from '@/lib/formlens/kannadaNormalize';

export interface Taluk {
  name: string;
  kannada: string;
  villages: string[];
}

export interface District {
  name: string;
  kannada: string;
  taluks: Taluk[];
}

export interface LocalityData {
  districts: District[];
}

interface LocalityEntry {
  name: string;
  kannada: string;
  type: 'district' | 'taluk' | 'village';
}

export interface SnapResult {
  value: string;
  englishName: string;
  kannadaName: string;
  score: number; // 0 = perfect, 1 = worst
}

export type LocalityMatcher = (query: string, maxScore?: number) => SnapResult | null;

/**
 * Pure factory creating a bilingual EN+KN locality matcher from LocalityData.
 */
export function createLocalityMatcher(data: LocalityData): LocalityMatcher {
  const entries: LocalityEntry[] = [];
  for (const d of data.districts) {
    entries.push({ name: d.name, kannada: d.kannada, type: 'district' });
    for (const t of d.taluks) {
      entries.push({ name: t.name, kannada: t.kannada, type: 'taluk' });
      for (const v of t.villages) {
        entries.push({ name: v, kannada: v, type: 'village' });
      }
    }
  }

  const fuse = new Fuse(entries, {
    keys: ['name', 'kannada'],
    threshold: 0.45,
    ignoreLocation: true,
    includeScore: true,
  });

  const levenshtein = (a: string, b: string): number => {
    const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0]!;
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j]!;
        dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length]!;
  };

  return (query: string, maxScore = 0.3): SnapResult | null => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const isKnQuery = hasKannada(trimmed);
    const qLower = trimmed.toLowerCase();

    // 1. Direct normalized Levenshtein check across entries (fast, length-accurate for both KN & EN)
    let bestLevEntry: LocalityEntry | null = null;
    let bestLevRatio = Infinity;
    for (const entry of entries) {
      const candidate = isKnQuery ? entry.kannada : entry.name;
      if (isKnQuery && !hasKannada(candidate)) continue;
      const cLower = candidate.toLowerCase();
      const maxLen = Math.max(qLower.length, cLower.length);
      if (Math.abs(qLower.length - cLower.length) > 3) continue;
      const dist = levenshtein(qLower, cLower);
      const ratio = dist / Math.max(1, maxLen);
      if (dist <= 3 && ratio <= Math.max(0.28, maxScore) && ratio < bestLevRatio) {
        bestLevRatio = ratio;
        bestLevEntry = entry;
      }
    }
    if (bestLevEntry) {
      const preferKn = isKnQuery && hasKannada(bestLevEntry.kannada);
      return {
        value: preferKn ? bestLevEntry.kannada : bestLevEntry.name,
        englishName: bestLevEntry.name,
        kannadaName: bestLevEntry.kannada,
        score: bestLevRatio,
      };
    }

    // 2. Fallback to Fuse.js for partial/substring locality queries
    const results = fuse.search(trimmed, { limit: 1 });
    const top = results[0];
    if (top && (top.score ?? 1) <= maxScore) {
      const preferKn = isKnQuery && hasKannada(top.item.kannada);
      return {
        value: preferKn ? top.item.kannada : top.item.name,
        englishName: top.item.name,
        kannadaName: top.item.kannada,
        score: top.score ?? 0,
      };
    }

    return null;
  };
}

let cachedMatcher: LocalityMatcher | null = null;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const res = await fetch('/data/karnataka_localities.json');
    if (!res.ok) return;
    const data = (await res.json()) as LocalityData;
    cachedMatcher = createLocalityMatcher(data);
    loaded = true;
  } catch {
    // Silently fail — no snap available
  }
}

/**
 * Returns the best-matching locality name (in Kannada if the query is Kannada,
 * otherwise English), or null if no good match.
 * @param query The raw OCR text
 * @param maxScore Fuse score threshold (default 0.3 — lower = stricter)
 */
export async function snapLocality(
  query: string,
  maxScore = 0.3,
): Promise<SnapResult | null> {
  await ensureLoaded();
  if (!cachedMatcher) return null;
  return cachedMatcher(query, maxScore);
}
