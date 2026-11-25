/**
 * Fuzzy locality snap using Fuse.js.
 * Matches district / taluk / village names from the Karnataka localities dictionary.
 */
import Fuse from 'fuse.js';

interface Taluk {
  name: string;
  kannada: string;
  villages: string[];
}

interface District {
  name: string;
  kannada: string;
  taluks: Taluk[];
}

interface LocalityData {
  districts: District[];
}

interface LocalityEntry {
  name: string;
  kannada: string;
  type: 'district' | 'taluk' | 'village';
}

let fuse: Fuse<LocalityEntry> | null = null;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const res = await fetch('/data/karnataka_localities.json');
    if (!res.ok) return;
    const data: LocalityData = await res.json() as LocalityData;
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
    fuse = new Fuse(entries, {
      keys: ['name', 'kannada'],
      threshold: 0.4,
      includeScore: true,
    });
    loaded = true;
  } catch {
    // Silently fail — no snap available
  }
}

export interface SnapResult {
  value: string;
  score: number; // 0 = perfect, 1 = worst
}

/**
 * Returns the best-matching locality name, or null if no good match.
 * @param query The raw OCR text
 * @param maxScore Fuse score threshold (default 0.3 — lower = stricter)
 */
export async function snapLocality(
  query: string,
  maxScore = 0.3,
): Promise<SnapResult | null> {
  await ensureLoaded();
  if (!fuse || !query.trim()) return null;
  const results = fuse.search(query.trim(), { limit: 1 });
  const top = results[0];
  if (!top || (top.score ?? 1) > maxScore) return null;
  return { value: top.item.name, score: top.score ?? 0 };
}

