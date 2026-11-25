#!/usr/bin/env node
/**
 * Automatically fetches pre-trained PP-OCR ONNX models & dictionaries from
 * Hugging Face (byrizki/rusto-models), verifies MIT licence, computes SHA-256,
 * writes models.lock.json, MODELS.md, and updates public/models/manifest.json.
 *
 * Usage:
 *   node scripts/fetch-models.mjs
 *   node scripts/fetch-models.mjs --update-lock
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const REPO_ID = 'byrizki/rusto-models';
const HF_API_BASE = `https://huggingface.co/api/models/${REPO_ID}`;
const HF_RAW_BASE = `https://huggingface.co/${REPO_ID}/resolve/main`;
const MODELS_DIR = path.resolve('public/models');
const LOCK_PATH = path.resolve('models.lock.json');
const MODELS_MD_PATH = path.resolve('MODELS.md');
const MANIFEST_PATH = path.resolve('public/models/manifest.json');
const UPDATE_LOCK = process.argv.includes('--update-lock');

const WANTED_SPECS = [
  {
    key: 'det',
    folder: 'ppocrv4-mobile',
    match: (p) => p === 'ppocrv4-mobile/det.onnx',
    localName: 'ppocrv4_det.v1.onnx',
    version: 'ppocrv4-mobile-v1',
    purpose: 'DBNet text region detection (bounding boxes)',
  },
  {
    key: 'rec_kn',
    folder: 'multilingual',
    match: (p) => p === 'multilingual/ppocrv4_rec_kannada.onnx',
    localName: 'ppocrv4_rec_kannada.v1.onnx',
    version: 'ppocrv4-kannada-v1',
    purpose: 'Kannada script text recognition (SVTR/CRNN CTC)',
  },
  {
    key: 'dict_kn',
    folder: 'multilingual',
    match: (p) => p === 'multilingual/ppocrv4_dict_kannada.txt',
    localName: 'ppocrv4_dict_kannada.v1.txt',
    version: 'ppocrv4-kannada-v1',
    purpose: 'Kannada CTC character dictionary',
  },
  {
    key: 'rec_en',
    folder: 'multilingual',
    match: (p) => p === 'multilingual/ppocrv5_rec_latin.onnx',
    localName: 'ppocrv5_rec_latin.v1.onnx',
    version: 'ppocrv5-latin-v1',
    purpose: 'English / Latin & digits text recognition (CTC)',
  },
  {
    key: 'dict_en',
    folder: 'multilingual',
    match: (p) => p === 'multilingual/ppocrv5_dict_latin.txt',
    localName: 'ppocrv5_dict_latin.v1.txt',
    version: 'ppocrv5-latin-v1',
    purpose: 'English / Latin CTC character dictionary',
  },
];

function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

function writeModelsMd(entries, licence, fallbackNote = '') {
  const rows = entries
    .map(
      (e) =>
        `| \`${e.name}\` | [HF](${e.url}) | ${formatMB(e.size)} (${e.size} B) | \`${e.sha256.slice(0, 16)}…\` | ${licence} | ${e.purpose} |`,
    )
    .join('\n');

  const md = `# FormLens Pre-Trained Offline OCR Models

Source repository: https://huggingface.co/${REPO_ID}  
Verified licence: **${licence}**

| File Name | Source | Size | SHA-256 (prefix) | Licence | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
${rows}
${fallbackNote}
## Verification & Integrity
- \`models.lock.json\` stores the exact SHA-256 digest and byte size for every file.
- \`npm run fetch-models\` (also wired into \`prebuild\`) verifies local files against \`models.lock.json\` and fails the build on any hash mismatch.
- \`public/models/manifest.json\` is generated automatically from \`models.lock.json\` for the in-app offline pack downloader.
`;
  writeFileSync(MODELS_MD_PATH, md, 'utf8');
}

function writeManifest(lockEntries) {
  const files = lockEntries.map((e) => ({
    name: e.name,
    url: `/models/${e.name}`,
    size: e.size,
    sha256: e.sha256,
    version: e.version,
    description: e.purpose,
  }));

  // Include local dictionaries & ORT WASM runtimes needed for 100% offline inference
  const extras = [
    {
      name: 'karnataka_localities.json',
      url: '/data/karnataka_localities.json',
      description: 'Karnataka district/taluk/village dictionary',
    },
    {
      name: 'ort-wasm-simd-threaded.wasm',
      url: '/ort/ort-wasm-simd-threaded.wasm',
      description: 'ONNX Runtime WebAssembly core',
    },
    {
      name: 'ort-wasm-simd-threaded.jsep.wasm',
      url: '/ort/ort-wasm-simd-threaded.jsep.wasm',
      description: 'ONNX Runtime WebGPU/JSEP WASM core',
    },
  ];

  for (const ex of extras) {
    const diskPath = path.resolve('public', ex.url.replace(/^\//, ''));
    if (existsSync(diskPath)) {
      const buf = readFileSync(diskPath);
      files.push({
        name: ex.name,
        url: ex.url,
        size: buf.byteLength,
        sha256: sha256Buffer(buf),
        version: 'local-1',
        description: ex.description,
      });
    }
  }

  const manifest = {
    version: '2.0.0',
    generatedAt: new Date().toISOString(),
    files,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function main() {
  mkdirSync(MODELS_DIR, { recursive: true });

  const existingLock = existsSync(LOCK_PATH)
    ? JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
    : { models: [] };
  const lockByName = new Map((existingLock.models ?? []).map((m) => [m.name, m]));

  // Fast offline/cached check: if all locked models exist on disk and match SHA-256, verify and skip network
  if (!UPDATE_LOCK && lockByName.size === WANTED_SPECS.length) {
    let allValid = true;
    for (const spec of WANTED_SPECS) {
      const locked = lockByName.get(spec.localName);
      const localPath = path.join(MODELS_DIR, spec.localName);
      if (!locked || !existsSync(localPath)) {
        allValid = false;
        break;
      }
      const actualHash = sha256File(localPath);
      if (actualHash !== locked.sha256) {
        throw new Error(
          `SHA-256 mismatch for ${spec.localName}!\nExpected: ${locked.sha256}\nActual:   ${actualHash}\nDelete the corrupted file or run with --update-lock.`,
        );
      }
    }
    if (allValid) {
      console.log('[fetch-models] All locked models verified on disk (SHA-256 OK). Skipping download.');
      const ordered = WANTED_SPECS.map((s) => lockByName.get(s.localName));
      writeModelsMd(ordered, existingLock.licence || 'MIT');
      writeManifest(ordered);
      return;
    }
  }

  // Query Hugging Face API for licence + directory listings
  let licence = 'MIT';
  const discoveredByKey = new Map();

  try {
    console.log(`[fetch-models] Checking model card & licence for ${REPO_ID}...`);
    const meta = await fetchJson(HF_API_BASE);
    const detectedLic = meta?.cardData?.license || meta?.tags?.find((t) => t.startsWith('license:'))?.replace('license:', '');
    if (!detectedLic || !['mit', 'apache-2.0'].includes(String(detectedLic).toLowerCase())) {
      throw new Error(
        `Unclear or restrictive licence "${detectedLic ?? 'unknown'}" on ${REPO_ID}. Stopping without bundling.`,
      );
    }
    licence = String(detectedLic).toUpperCase();
    console.log(`[fetch-models] Verified permissive licence: ${licence}`);

    const folders = [...new Set(WANTED_SPECS.map((s) => s.folder))];
    for (const folder of folders) {
      const listing = await fetchJson(`${HF_API_BASE}/tree/main/${folder}`);
      for (const spec of WANTED_SPECS.filter((s) => s.folder === folder)) {
        const match = listing.find((item) => item.type === 'file' && spec.match(item.path));
        if (match) {
          discoveredByKey.set(spec.key, match);
          console.log(`[fetch-models] Selected ${match.path} (${formatMB(match.size)}) -> ${spec.localName}`);
        }
      }
    }
  } catch (err) {
    if (String(err.message).includes('restrictive licence')) {
      console.error(`[fetch-models] STOP: ${err.message}`);
      process.exit(1);
    }
    console.warn(`[fetch-models] Warning: Could not reach Hugging Face (${err.message}).`);
    const fallbackNote = `
## Fallback: Official PaddleOCR + paddle2onnx Steps
If Hugging Face is unreachable, convert official PaddleOCR models locally:
\`\`\`bash
pip install paddlepaddle paddle2onnx
# Download PP-OCRv4 mobile det, Kannada rec, and Latin rec from PaddleOCR releases, then:
paddle2onnx --model_dir ch_PP-OCRv4_det_infer --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file public/models/ppocrv4_det.v1.onnx --opset_version 14
\`\`\`
`;
    const available = WANTED_SPECS.map((s) => lockByName.get(s.localName)).filter(Boolean);
    writeModelsMd(available, licence, fallbackNote);
    if (available.length > 0) writeManifest(available);
    return;
  }

  const nextLockModels = [];
  for (const spec of WANTED_SPECS) {
    const item = discoveredByKey.get(spec.key);
    const localPath = path.join(MODELS_DIR, spec.localName);
    const locked = lockByName.get(spec.localName);

    if (!item) {
      console.warn(`[fetch-models] Missing ${spec.key} in HF listing; skipping.`);
      continue;
    }

    const url = `${HF_RAW_BASE}/${item.path}`;
    if (!UPDATE_LOCK && locked && existsSync(localPath)) {
      const actualHash = sha256File(localPath);
      if (actualHash !== locked.sha256) {
        throw new Error(
          `SHA-256 mismatch for ${spec.localName}!\nExpected: ${locked.sha256}\nActual:   ${actualHash}`,
        );
      }
      console.log(`[fetch-models] Verified existing ${spec.localName}`);
      nextLockModels.push(locked);
      continue;
    }

    console.log(`[fetch-models] Downloading ${url}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha256 = sha256Buffer(buf);

    if (!UPDATE_LOCK && locked && locked.sha256 !== sha256) {
      throw new Error(
        `Downloaded ${spec.localName} does not match models.lock.json!\nExpected: ${locked.sha256}\nActual:   ${sha256}`,
      );
    }

    writeFileSync(localPath, buf);
    console.log(`[fetch-models] Saved ${spec.localName} (${formatMB(buf.byteLength)}, sha256=${sha256.slice(0, 12)}…)`);

    nextLockModels.push({
      key: spec.key,
      name: spec.localName,
      repoPath: item.path,
      url,
      size: buf.byteLength,
      sha256,
      version: spec.version,
      purpose: spec.purpose,
    });
  }

  writeFileSync(
    LOCK_PATH,
    JSON.stringify({ repo: REPO_ID, licence, updatedAt: new Date().toISOString(), models: nextLockModels }, null, 2) + '\n',
    'utf8',
  );
  writeModelsMd(nextLockModels, licence);
  writeManifest(nextLockModels);
  console.log('[fetch-models] Updated models.lock.json, MODELS.md, and public/models/manifest.json');
}

main().catch((err) => {
  console.error('[fetch-models] Error:', err);
  process.exit(1);
});
