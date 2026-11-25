# FormLens Codebase Audit

**Date:** 2026-11-25  
**Repo:** `/Users/sarju/SML labs/SYNAPSE-2.0`  
**Framework:** TanStack Start (SSR) + React 19 + Vite 8 + Tailwind v4 + shadcn/ui

---

## What Exists (Lovable Starter Scaffold)

| File / Area | Status | Notes |
|---|---|---|
| `package.json` | ✅ Present | TanStack Start, React 19, Tailwind v4, shadcn/ui — all production deps. **Missing:** `dexie`, `onnxruntime-web`, `vite-plugin-pwa`, `fuse.js`, `jspdf`. |
| `vite.config.ts` | ✅ Present | Uses `@lovable.dev/vite-tanstack-config` wrapper. **No PWA plugin**, no ONNX WASM handling. |
| `tsconfig.json` | ✅ Present | Strict mode, Bundler resolution, `@/` alias. Compatible with planned additions. |
| `src/styles.css` | ✅ Present | Full Tailwind v4 design tokens (oklch). No app-specific styles. |
| `src/routes/__root.tsx` | ✅ Present | Root shell with QueryClient, error boundary, 404. Title still says "Lovable App". |
| `src/routes/index.tsx` | ⚠️ Stub | Renders a blank-page SVG placeholder. **Must be replaced** with FormLens home / router shell. |
| `src/router.tsx` | ✅ Present | Standard TanStack router. |
| `src/routeTree.gen.ts` | ✅ Present | Auto-generated, only `/` route. Must regen after adding routes. |
| `src/start.ts` | ✅ Present | CSRF + error middleware. No changes needed. |
| `src/server.ts` | ✅ Present | h3 SSR error wrapper. No changes needed. |
| `src/lib/utils.ts` | ✅ Present | `cn()` helper. |
| `src/lib/error-*.ts` | ✅ Present | Lovable error capture / reporting. |
| `src/hooks/use-mobile.tsx` | ✅ Present | `useIsMobile()` hook. |
| `src/components/ui/` | ✅ Present | Full shadcn/ui component library (accordion→tooltip). |
| `src/integrations/supabase/client.ts` | ⚠️ Throws if env missing | Auto-generated; uses lazy proxy — safe as long as we never call `supabase` while offline. |
| `src/integrations/supabase/types.ts` | ⚠️ Empty schema | Tables are `[_ in never]: never` — no FormLens tables exist yet. |
| `src/test/app-routing.test.tsx` | ✅ Present | Basic routing test passes. |
| `supabase/config.toml` | ✅ Present | Project ID only. No migrations folder. |
| `public/favicon.ico` | ✅ Present | Generic Lovable favicon. |
| `public/robots.txt` | ✅ Present | Standard. |
| `.env` | ✅ Present | Supabase URL + publishable key. `.gitignore` **not** present — need to verify secrets not committed. |

---

## What Is Missing (100% — Not Started)

### Infrastructure / Build
- [ ] `vite-plugin-pwa` not installed, no service worker, no `manifest.webmanifest`
- [ ] No PWA icons (192×192, 512×512, maskable)
- [ ] No Workbox precache config (`.onnx`, `.wasm`, `.json` caching)
- [ ] No offline status bar component
- [ ] No install prompt (`beforeinstallprompt`) handler
- [ ] `dexie` not installed — no IndexedDB schema
- [ ] `onnxruntime-web` not installed — no on-device inference
- [ ] `fuse.js` not installed — no fuzzy search for localities
- [ ] `jspdf` not installed — no PDF export

### Routes / Screens (all missing)
- [ ] `/setup` — First-run download-pack screen
- [ ] `/scan` — Camera / gallery capture + template picker
- [ ] `/review/:id` — Field-by-field review and edit
- [ ] `/forms` — Saved forms list
- [ ] `/settings` — Pack status, storage, engine switch, language toggle

### Public Assets (all missing)
- [ ] `public/models/manifest.json` — Model file list
- [ ] `public/models/ocr_crnn_int8.onnx` — Actual model (placeholder needed)
- [ ] `public/models/charset.json` — CTC character set
- [ ] `public/ort/` — ONNX Runtime WASM files (must be local, not CDN)
- [ ] `public/templates/` — JSON form templates (Kannada + English labels, bboxes)
- [ ] `public/data/karnataka_localities.json` — District/taluk/village list

### Source Code (all missing)
- [ ] `src/config/model.ts` — Model contract (shape, preprocessing config)
- [ ] `src/db/schema.ts` — Dexie schema (forms, fields, settings, syncQueue)
- [ ] `src/db/index.ts` — Dexie instance export
- [ ] `src/workers/ocr.worker.ts` — Web Worker with `OcrEngine` interface
- [ ] `src/workers/mock-engine.ts` — `MockOcrEngine`
- [ ] `src/workers/onnx-engine.ts` — `OnnxOcrEngine` (with TODOs for model shape)
- [ ] `src/hooks/useOcrWorker.ts` — React hook wrapping worker postMessage
- [ ] `src/hooks/useOfflineStatus.ts` — `navigator.onLine` + event listeners
- [ ] `src/hooks/useInstallPrompt.ts` — `beforeinstallprompt` capture
- [ ] `src/hooks/useStorageEstimate.ts` — `navigator.storage.estimate()`
- [ ] `src/components/OfflineStatusBar.tsx`
- [ ] `src/components/ConfidenceBadge.tsx`
- [ ] `src/components/FieldCard.tsx`
- [ ] `src/components/TemplatePicker.tsx`
- [ ] `src/components/CameraCapture.tsx`
- [ ] `src/components/ManualCrop.tsx` (4-corner UI; OpenCV.js optional offline)
- [ ] `src/lib/validators.ts` — date, phone, pincode, numeric validators
- [ ] `src/lib/fuzzySnap.ts` — Fuse.js locality matching
- [ ] `src/lib/exports.ts` — JSON, CSV, PDF export
- [ ] `src/lib/syncQueue.ts` — IndexedDB queue + online-event uploader
- [ ] `src/lib/packDownloader.ts` — Cache Storage download with progress
- [ ] `src/lib/i18n.ts` — English/Kannada string map
- [ ] `src/routes/setup.tsx`
- [ ] `src/routes/scan.tsx`
- [ ] `src/routes/review.$id.tsx`
- [ ] `src/routes/forms.tsx`
- [ ] `src/routes/settings.tsx`
- [ ] `supabase/migrations/0001_formlens_tables.sql`

---

## What Is Broken / Problematic

| Issue | Severity | Detail |
|---|---|---|
| `src/routes/index.tsx` loads CDN image | 🔴 Breaks offline | `<img src="https://cdn.gpteng.co/blank-app-v1.svg">` — an external network request on every load. |
| Supabase client throws if env missing | 🟡 Latent | The lazy proxy is safe until first access, but calling `supabase` while offline (no env) would throw. We must gate all Supabase usage behind auth check + online check. |
| No `.gitignore` observed | 🟡 Security | `.env` with real Supabase publishable key is in-repo. Must add `.gitignore` with `.env`. |
| `src/routeTree.gen.ts` — SSR mode declared | 🟡 PWA conflict | TanStack Start runs as an SSR app (Nitro/Cloudflare). A pure client-side PWA needs `navigateFallback: index.html`. We will keep SSR for the shell and ensure the SW serves the shell for navigation requests. |
| `@lovable.dev/vite-tanstack-config` wraps vite | 🟡 PWA plugin conflict risk | Cannot add plugins manually without risk of duplicating TanStack/Tailwind. Must pass `vite.plugins` via `defineConfig({ vite: { plugins: [...] } })` per the config file comment. |
| No `public/icons/` | 🟡 PWA installability | App can't be installed without at least one 192px icon. |
| No `maximumFileSizeToCacheInBytes` in SW | 🟡 Missing | Workbox default 2 MB cap would skip `.onnx` and `.wasm` files. |

---

## Ambiguities Resolved (noted here)

1. **SSR vs. SPA**: The scaffold uses TanStack Start (SSR). We will keep SSR for initial HTML delivery but add `vite-plugin-pwa` with `navigateFallback` so the SW serves the app shell offline. This is the simplest approach that keeps the existing router working.
2. **OpenCV.js**: Offline loading of OpenCV.js WASM (~8 MB) adds complexity. We will implement a **manual 4-corner crop UI** first (simpler, fully offline), with a TODO for OpenCV auto-perspective correction.
3. **Model files**: Real `.onnx` model files require offline ML training. We will add **placeholder stub files** (1-byte JSON/binary) with the correct manifest structure, so the download/cache/self-test flow works. The README will document exact model contract for future plug-in.
4. **iOS "Add to Home Screen"**: Will show a dismissable banner when `navigator.standalone === false` on iOS Safari, since `beforeinstallprompt` does not fire on iOS.
5. **CTC greedy decoding**: Will be implemented in the OCR worker; character probability = softmax of CTC logit, field confidence = geometric mean of per-step max probabilities.

---

## Work Plan Status

| Step | Status |
|---|---|
| 1. Audit + fix build errors | 🔄 In progress |
| 2. PWA shell | ⬜ Not started |
| 3. Setup/download-pack screen | ⬜ Not started |
| 4. Dexie schema | ⬜ Not started |
| 5. Scan screen | ⬜ Not started |
| 6. OCR worker | ⬜ Not started |
| 7. Review/edit screen | ⬜ Not started |
| 8. Saved forms + settings | ⬜ Not started |
| 9. Supabase auth + migration | ⬜ Not started |
| 10. Bilingual UI | ⬜ Not started |
| 11. Tests + verification | ⬜ Not started |
