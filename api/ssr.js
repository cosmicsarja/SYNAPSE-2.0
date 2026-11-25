// Vercel Edge Function — delegates all SSR requests to the TanStack Start
// Cloudflare-compatible fetch handler built by vite to dist/server/server.js.
// Edge runtime supports the same Request/Response/fetch globals as CF Workers.

import handler from '../dist/server/server.js';

export const config = { runtime: 'edge' };

export default function (request) {
  return handler.fetch(request, {}, {});
}
