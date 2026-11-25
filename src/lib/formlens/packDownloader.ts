/**
 * Offline pack downloader.
 * Downloads all files from /models/manifest.json into Cache Storage.
 * Also caches the app shell, ORT WASM, dictionaries, and templates.
 */

export interface ManifestFile {
  name: string;
  url: string;
  size: number;
  sha256?: string;
  version?: string;
  description?: string;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface Manifest {
  version: string;
  files: ManifestFile[];
}

export interface DownloadProgress {
  phase: 'fetching-manifest' | 'downloading' | 'caching-shell' | 'done' | 'error';
  fileIndex: number;      // 0-based
  totalFiles: number;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  error?: string;
}

type ProgressCallback = (p: DownloadProgress) => void;

const CACHE_NAME = 'formlens-offline-pack-v1';

/** All extra URLs to precache beyond the manifest model files */
const SHELL_URLS = [
  '/',
  '/scan',
  '/forms',
  '/settings',
  '/setup',
  '/install',
  '/manifest.webmanifest',
  '/data/karnataka_localities.json',
  '/templates/auto-extract.json',
  '/templates/ration-card.json',
  '/templates/income-certificate.json',
];

export async function downloadOfflinePack(
  onProgress: ProgressCallback,
): Promise<Manifest> {
  // 1. Fetch manifest
  onProgress({ phase: 'fetching-manifest', fileIndex: 0, totalFiles: 0, fileName: 'manifest.json', bytesDownloaded: 0, totalBytes: 0 });

  const manifestRes = await fetch('/models/manifest.json', { cache: 'no-store' });
  if (!manifestRes.ok) throw new Error(`Failed to fetch manifest: ${manifestRes.status}`);
  const manifest: Manifest = await manifestRes.json() as Manifest;

  const cache = await caches.open(CACHE_NAME);

  const totalBytes = manifest.files.reduce((s, f) => s + f.size, 0);
  let bytesDownloaded = 0;

  // 2. Download each model file
  for (let i = 0; i < manifest.files.length; i++) {
    const file = manifest.files[i];
    if (!file) continue;
    onProgress({
      phase: 'downloading',
      fileIndex: i,
      totalFiles: manifest.files.length,
      fileName: file.name,
      bytesDownloaded,
      totalBytes,
    });

    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`Failed to download ${file.name}: ${res.status}`);
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const buf = await res.arrayBuffer();
    if (file.sha256) {
      const actual = await sha256Hex(buf);
      if (actual !== file.sha256) {
        throw new Error(`Integrity check failed for ${file.name} (expected ${file.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
      }
    }
    await cache.put(file.url, new Response(buf, { status: 200, headers: { 'Content-Type': contentType } }));
    bytesDownloaded += buf.byteLength || file.size;
  }

  // 3. Cache app shell URLs
  onProgress({ phase: 'caching-shell', fileIndex: manifest.files.length, totalFiles: manifest.files.length, fileName: 'App shell', bytesDownloaded, totalBytes });

  for (const url of SHELL_URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    } catch {
      // Not fatal — service worker will also cache these
    }
  }

  // 4. Request persistent storage
  if (navigator.storage?.persist) {
    await navigator.storage.persist();
  }

  onProgress({ phase: 'done', fileIndex: manifest.files.length, totalFiles: manifest.files.length, fileName: '', bytesDownloaded: totalBytes, totalBytes });

  return manifest;
}

/** Returns true if all files from the manifest are present in cache. */
export async function verifyOfflinePack(manifest: Manifest): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME);
  for (const file of manifest.files) {
    const cached = await cache.match(file.url);
    if (!cached) return false;
  }
  return true;
}

/** Returns cached manifest from last download, or null. */
export async function getCachedManifest(): Promise<Manifest | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match('/models/manifest.json');
    if (!res) return null;
    return await res.json() as Manifest;
  } catch {
    return null;
  }
}

