# FormLens — Build & PWA Verification

Generated: 2026-11-25

## Build status

| Check | Result |
|---|---|
| `npm run build` | ✅ exits 0 |
| TypeScript errors | ✅ none |
| Vite bundle | ✅ 2263+ modules transformed |
| PWA SW generated | ✅ `.output/public/sw.js` |
| Precache entries | ✅ 35 entries (~2 MB static assets) |
| Nitro output | ✅ `.output/server/index.mjs` (Cloudflare Worker) |

## PWA installability criteria

| Criterion | Status | Notes |
|---|---|---|
| `manifest.webmanifest` present | ✅ | At `/manifest.webmanifest` |
| `name` + `short_name` | ✅ | "FormLens" / "FormLens" |
| `id: "/"` | ✅ | Unique app identity |
| `start_url: "/"` + `scope: "/"` | ✅ | |
| `display: "standalone"` | ✅ | |
| `theme_color` + `background_color` | ✅ | |
| Icon 192×192 PNG | ✅ | `/icons/icon-192.png` |
| Icon 512×512 PNG | ✅ | `/icons/icon-512.png` |
| Icon 512×512 maskable PNG | ✅ | `/icons/icon-512-maskable.png` |
| `apple-touch-icon` 180×180 | ✅ | `/icons/apple-touch-icon.png` in `<head>` |
| Service Worker registered | ✅ | Via `vite-plugin-pwa` `registerSW.js` |
| SW fetch handler | ✅ | Workbox `generateSW` mode |
| `navigateFallback` | ✅ | Handled by SSR/Nitro (not SW — correct for TanStack Start) |
| HTTPS required | ⚠️ | Required in production; Vercel provides HTTPS automatically |
| `theme-color` meta tag | ✅ | In `src/routes/__root.tsx` |
| `apple-mobile-web-app-capable` | ✅ | In `<head>` |
| `viewport-fit=cover` | ✅ | In viewport meta |

## Output files verified

```
.output/public/
├── sw.js                          ✅ service worker
├── workbox-9778d006.js            ✅ workbox runtime
├── manifest.webmanifest           ✅ PWA manifest
├── icons/
│   ├── icon-192.png               ✅ 192×192
│   ├── icon-512.png               ✅ 512×512
│   ├── icon-512-maskable.png      ✅ 512×512 maskable
│   └── apple-touch-icon.png       ✅ 180×180
├── models/
│   ├── manifest.json              ✅ model pack index
│   ├── charset.json               ✅ character set
│   └── ocr_crnn_int8.onnx         ⚠️ placeholder (1 byte — real model needed)
├── ort/
│   ├── ort.min.js                 ✅
│   ├── ort.wasm.min.js            ✅
│   ├── ort-wasm-simd-threaded.wasm ✅
│   ├── ort-wasm-simd.wasm         ✅
│   ├── ort-wasm-threaded.wasm     ✅
│   └── ort-wasm.wasm              ✅
├── data/
│   └── karnataka_localities.json  ✅
├── templates/
│   ├── ration-card.json           ✅
│   └── income-certificate.json    ✅
└── .well-known/
    └── assetlinks.json            ✅ (SHA-256 TODO for TWA)
```

## Routes verified

| Route | Purpose |
|---|---|
| `/` | Redirect splash — routes to `/scan` or `/setup` |
| `/setup` | First-time pack download, shows InstallBanner |
| `/scan` | Camera capture + OCR |
| `/review/$id` | Field review and editing |
| `/forms` | Saved forms list |
| `/settings` | Settings, storage, engine, auth, InstallBanner |
| `/install` | Shareable install page with QR, iOS instructions |

## Vercel deployment notes

`vercel.json` configures:
- SPA rewrite for all non-asset routes → `/index.html`
- `Cache-Control: no-cache` for `sw.js` and `registerSW.js`
- `Content-Type: application/manifest+json` for manifest
- `Cache-Control: immutable` + correct MIME types for `/models/*` and `/ort/*.wasm`
- `Content-Type: application/json` for `/.well-known/assetlinks.json`

> **Model file size:** Vercel Hobby plan has a 100 MB per-file limit. The placeholder ONNX model is 1 byte. When the real model is ready, if it exceeds 100 MB, host it in Supabase Storage (public bucket) or another CDN and update `public/models/manifest.json` URLs accordingly.

> **COOP/COEP headers:** NOT added. Multi-threaded WASM (`SharedArrayBuffer`) is not enabled or tested. If you need multi-threaded ORT inference in future, add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers in `vercel.json` and test thoroughly.

## What cannot be verified without a real browser session

| Check | How to verify |
|---|---|
| Chrome installability (no errors in Application tab) | Chrome DevTools → Application → Manifest |
| `beforeinstallprompt` fires | Chrome on Android or desktop with Lighthouse |
| Lighthouse PWA score | `npx lighthouse https://your-vercel-domain --view` |
| iOS "Add to Home Screen" flow | Safari on iPhone/iPad |
| Offline mode after SW activation | DevTools → Network → Offline checkbox |
| TWA full-screen (no URL bar) | Sideload APK with correct assetlinks.json |

## Known limitations / TODOs

- [ ] Real `ocr_crnn_int8.onnx` model file — currently a placeholder; ONNX OCR won't produce real results
- [ ] `assetlinks.json` SHA-256 fingerprint — replace TODO with real keystore fingerprint for TWA
- [ ] APK download URL in `src/routes/install.tsx` — update `APK_DOWNLOAD_URL` after uploading to GitHub Releases
- [ ] Supabase sync — tables and RLS exist in `supabase/migrations/0001_formlens_tables.sql`; run migration with `supabase db push`
- [ ] Camera permissions on iOS require HTTPS (satisfied by Vercel)
- [ ] `vite preview` does not work with Cloudflare preset — use `npx serve .output/public --single` for local static preview

## Commits

| Commit | Description |
|---|---|
| `7634445` | feat: FormLens complete implementation (53 files) |
| `1d42836` | feat: PWA installability — InstallBanner, /install page, vercel.json, TWA docs, PNG icons |
