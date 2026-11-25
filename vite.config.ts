// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// Never set ssr.external or resolve.external: the Worker has no runtime module resolution, so
// the build fails. Never add compression (compressPublicAssets, vite-plugin-compression):
// hosting already compresses at the edge.
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Disable Nitro/Cloudflare Worker output — build as a plain SPA for Vercel static hosting.
  // Output goes to dist/ which Vercel serves directly with the rewrites in vercel.json.
  nitro: false,
  vite: {
    plugins: [
      VitePWA({
        // Don't auto-register in dev; register manually from the app shell
        // so we can control update prompts
        registerType: "prompt",
        injectRegister: false,
        // Self-hosted manifest (we have /public/manifest.webmanifest)
        manifest: false,
        // TanStack Start (Nitro) writes client assets to .output/public/
        // vite-plugin-pwa must look there for precache manifest generation.
        // We use injectManifest strategy so the SW is a hand-authored file;
        // the glob patterns here are advisory — the runtime caching handles the rest.
        strategies: "generateSW",
        outDir: "dist/client",
        // Workbox config — precache app shell + big assets
        workbox: {
          globDirectory: "dist/client",
          globPatterns: [
            "assets/**/*.{js,css}",
            "index.html",
            "manifest.webmanifest",
            "icons/*.png",
          ],
          // Allow large .onnx and .wasm files (up to 100 MB)
          maximumFileSizeToCacheInBytes: 100 * 1024 * 1024,
          navigateFallback: '/index.html', // SPA — serve shell for all navigation when offline
          runtimeCaching: [
            {
              urlPattern: /\/models\/.*\.(onnx|json)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "formlens-offline-pack-v1",
                expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
              },
            },
            {
              urlPattern: /\/ort\/.*\.wasm$/,
              handler: "CacheFirst",
              options: {
                cacheName: "formlens-ort-wasm",
                expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
              },
            },
            {
              urlPattern: /\/data\/.*\.json$/,
              handler: "CacheFirst",
              options: {
                cacheName: "formlens-data",
                expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 },
              },
            },
            {
              urlPattern: /\/templates\/.*\.json$/,
              handler: "CacheFirst",
              options: {
                cacheName: "formlens-templates",
                expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 },
              },
            },
            {
              urlPattern: /^https:\/\//,
              handler: "NetworkFirst",
              options: { cacheName: "formlens-network", networkTimeoutSeconds: 3 },
            },
          ],
        },
      }),
    ],
    // Ensure WASM files from onnxruntime-web are served correctly
    optimizeDeps: {
      exclude: ["onnxruntime-web"],
    },
    // Worker files need to be treated as ES modules
    worker: {
      format: "es",
    },
  },
});
