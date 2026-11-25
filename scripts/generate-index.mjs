// Post-build: run the TanStack Start SSR handler to pre-render index.html
// This turns the SSR app into a static SPA shell for Vercel static hosting.
import { writeFileSync } from 'fs';

let html = null;

try {
  const { default: handler } = await import('../dist/server/server.js');
  const request = new Request('http://localhost/', {
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  const response = await handler.fetch(request, {}, {});
  if (response.status < 500) {
    html = await response.text();
    console.log(`✓ SSR rendered index.html (${html.length} bytes, status ${response.status})`);
  } else {
    console.warn('SSR returned', response.status, '— falling back to shell HTML');
  }
} catch (e) {
  console.warn('SSR render failed:', e.message, '— generating shell HTML');
}

// Fallback: minimal shell HTML that bootstraps the React SPA client-side
if (!html) {
  const { readdirSync } = await import('fs');
  const assets = readdirSync('dist/client/assets');
  const clientEntry = assets.find(f => f.startsWith('client-') && f.endsWith('.js'));
  const cssEntry = assets.find(f => f.endsWith('.css'));
  if (!clientEntry) { console.error('Could not find client entry JS'); process.exit(1); }
  html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#1e3a5f" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <title>FormLens</title>
  ${cssEntry ? `<link rel="stylesheet" href="/assets/${cssEntry}" />` : ''}
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/${clientEntry}"></script>
</body>
</html>`;
  console.log(`✓ Generated shell index.html with entry: ${clientEntry}`);
}

writeFileSync('dist/client/index.html', html);
