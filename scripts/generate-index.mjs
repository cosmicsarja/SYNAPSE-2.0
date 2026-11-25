// Post-build: run the TanStack Start SSR handler to pre-render static HTML
// for /, /setup, /scan, /forms, /settings, and /install into dist/client/.
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const ROUTES = [
  { path: '/', out: 'dist/client/index.html' },
  { path: '/setup', out: 'dist/client/setup/index.html' },
  { path: '/scan', out: 'dist/client/scan/index.html' },
  { path: '/forms', out: 'dist/client/forms/index.html' },
  { path: '/settings', out: 'dist/client/settings/index.html' },
  { path: '/install', out: 'dist/client/install/index.html' },
];

const { default: handler } = await import('../dist/server/server.js');

for (const route of ROUTES) {
  const request = new Request(`http://localhost${route.path}`, {
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  const response = await handler.fetch(request, {}, {});
  if (response.status >= 500) {
    throw new Error(`SSR returned ${response.status} for ${route.path}`);
  }
  const html = await response.text();
  mkdirSync(dirname(route.out), { recursive: true });
  writeFileSync(route.out, html);
  console.log(`✓ SSR rendered ${route.out} (${html.length} bytes)`);
}
