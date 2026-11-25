// Post-build: generate dist/client/sw.js with Workbox precache + runtime caching.
// Runs AFTER vite build and generate-index.mjs so all HTML + JS/CSS assets exist.
import { appendFileSync, readFileSync } from 'fs';
import { generateSW } from 'workbox-build';

const swDest = 'dist/client/sw.js';

const { count, size, warnings } = await generateSW({
  globDirectory: 'dist/client',
  swDest,
  globPatterns: [
    'index.html',
    '*/index.html',
    'manifest.webmanifest',
    'favicon.ico',
    'assets/**/*.{js,css}',
    'icons/*.png',
    'data/*.json',
    'templates/*.json',
    'models/*.json',
  ],
  maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [
    /^\/(assets|icons|models|ort|data|templates|tessdata|tesseract|downloads|\.well-known)/,
  ],
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: false,
  runtimeCaching: [
    {
      urlPattern: /\/tessdata\/.*\.traineddata\.gz$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'formlens-offline-pack-v1',
        expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/tesseract\/.*\.(js|wasm)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'formlens-offline-pack-v1',
        expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/models\/.*\.(onnx|json)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'formlens-offline-pack-v1',
        expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/ort\/.*\.(wasm|mjs|js)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'formlens-ort-wasm',
        expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/assets\/.*\.wasm$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'formlens-ort-wasm',
        expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/data\/.*\.json$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'formlens-data',
        expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/templates\/.*\.json$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'formlens-templates',
        expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
  ],
});

// Ensure SKIP_WAITING message listener is present for update toast
const swContent = readFileSync(swDest, 'utf8');
if (!swContent.includes('SKIP_WAITING')) {
  appendFileSync(
    swDest,
    `\nself.addEventListener("message",function(e){if(e.data&&e.data.type==="SKIP_WAITING"){self.skipWaiting()}});\n`,
  );
}

for (const w of warnings) {
  console.warn('[workbox warning]', w);
}
console.log(`✓ Generated ${swDest}: precaching ${count} files (${(size / 1024 / 1024).toFixed(2)} MB)`);
