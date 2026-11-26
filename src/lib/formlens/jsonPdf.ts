/**
 * Editable JSON <-> Kannada/English PDF converter.
 * Supports:
 * - Layout-preserving PDF ("like the image"): places edited JSON text at exact normBbox
 *   coordinates on a clean white page (or over the original photo), matching the image aspect ratio.
 * - Table PDF: structured Field / Value / Confidence table.
 * Renders via HTML Canvas into jsPDF so Kannada Unicode glyphs shape accurately 100% offline.
 */
import { jsPDF } from 'jspdf';
import type { FormField, SavedForm } from '@/db/schema';

export type PdfRenderMode = 'layout' | 'overlay' | 'table';

const BOILERPLATE_RE =
  /\b(space\s+for\s+pasting|to\s+be\s+filled\s+by\s+office|disclaimer|see\s+rules|self\s+attested|election\s+commission|electoral\s+registration\s+officer|application\s+form\s+for|unless\s+union\s+territories|passport\s+size\s+color\s+photograph)\b/i;

const ESSENTIAL_APPLICANT_RE =
  /(name|surname|father|mother|husband|wife|guardian|relative|gender|sex|dob|birth|age|mobile|phone|email|aadhaar|aadhar|pan|passport|ration|epic|voter|id|address|house|street|road|locality|town|village|post\s*office|tehsil|taluk|taluka|mandal|district|state|pin|constituency|assembly|income|caste|religion|occupation|bank|account|ಹೆಸರು|ವಿಳಾಸ|ಜನ್ಮ|ದಿನಾಂಕ|ವಯಸ್ಸು|ಲಿಂಗ|ಮೊಬೈಲ್|ದೂರವಾಣಿ|ಆಧಾರ್|ಜಿಲ್ಲೆ|ತಾಲೂಕು|ಗ್ರಾಮ|ರಾಜ್ಯ|ಪಿನ್|ಆದಾಯ|ಜಾತಿ|ಪಡಿತರ)/i;

/**
 * Filters fields down to essential applicant details (removing empty/Not found
 * entries and printed form boilerplate/instructions).
 */
export function filterApplicantFields(fields: EditableJsonField[]): EditableJsonField[] {
  const nonEmpty = fields.filter((f) => {
    const v = (f.value ?? '').trim();
    if (!v || v === 'Not found' || v === '—') return false;
    const combined = `${f.key} ${f.label} ${v}`;
    if (BOILERPLATE_RE.test(combined)) return false;
    return true;
  });

  const essential = nonEmpty.filter((f) =>
    ESSENTIAL_APPLICANT_RE.test(`${f.key} ${f.label}`),
  );

  return essential.length > 0 ? essential : nonEmpty;
}

export interface EditableJsonField {
  key: string;
  label: string;
  value: string;
  confidence?: number;
  normBbox?: [number, number, number, number] | null;
}

export interface EditableFormJson {
  title: string;
  template: string;
  date: string;
  imageWidth?: number;
  imageHeight?: number;
  fields: EditableJsonField[];
  notes?: string;
}

/**
 * Converts a scanned form and its fields into a clean editable JSON structure
 * preserving normalized bounding boxes for layout-exact PDF generation.
 */
export function formToEditableJson(form: SavedForm, fields: FormField[]): EditableFormJson {
  return {
    title: `FormLens Extract #${form.id ?? 'new'}`,
    template: form.templateName || 'Auto Extract',
    date: new Date(form.createdAt).toLocaleDateString('en-IN'),
    ...(form.imageWidth && form.imageHeight
      ? { imageWidth: form.imageWidth, imageHeight: form.imageHeight }
      : {}),
    fields: fields.map((f, idx) => ({
      key: f.fieldId || `field_${idx + 1}`,
      label: f.labelKn && f.labelKn !== f.labelEn ? `${f.labelEn} / ${f.labelKn}` : f.labelEn,
      value: f.textValue ?? '',
      confidence: Math.round((f.confidence ?? 0) * 100),
      ...(f.normBbox ? { normBbox: f.normBbox } : {}),
    })),
    notes: '',
  };
}

function parseNormBbox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

/**
 * Parses and validates user-edited JSON.
 * Supports both structured EditableFormJson ({ fields: [...] }) and flat key-value objects ({ "Name": "Ramesh" }).
 */
export function parseEditableJson(
  rawJson: string,
): { ok: true; data: EditableFormJson } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON syntax' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Root JSON value must be an object' };
  }

  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.fields)) {
    const fields: EditableJsonField[] = obj.fields.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        return { key: `field_${idx + 1}`, label: `Field ${idx + 1}`, value: String(item ?? '') };
      }
      const f = item as Record<string, unknown>;
      const key = typeof f.key === 'string' && f.key.trim() ? f.key.trim() : `field_${idx + 1}`;
      const label = typeof f.label === 'string' && f.label.trim() ? f.label.trim() : key;
      const value = f.value === undefined || f.value === null ? '' : String(f.value);
      const confidence = typeof f.confidence === 'number' ? f.confidence : undefined;
      const normBbox = parseNormBbox(f.normBbox);
      return {
        key,
        label,
        value,
        ...(confidence !== undefined ? { confidence } : {}),
        ...(normBbox ? { normBbox } : {}),
      };
    });

    return {
      ok: true,
      data: {
        title: typeof obj.title === 'string' && obj.title.trim() ? obj.title : 'FormLens Document',
        template: typeof obj.template === 'string' ? obj.template : 'Custom JSON',
        date: typeof obj.date === 'string' ? obj.date : new Date().toLocaleDateString('en-IN'),
        ...(typeof obj.imageWidth === 'number' && typeof obj.imageHeight === 'number'
          ? { imageWidth: obj.imageWidth, imageHeight: obj.imageHeight }
          : {}),
        fields,
        notes: typeof obj.notes === 'string' ? obj.notes : undefined,
      },
    };
  }

  // Flat key-value JSON object support: { "ಹೆಸರು": "ರಮೇಶ್", "Mobile": "9876543210" }
  const flatEntries = Object.entries(obj).filter(
    ([k]) =>
      k !== 'title' &&
      k !== 'template' &&
      k !== 'date' &&
      k !== 'notes' &&
      k !== 'imageWidth' &&
      k !== 'imageHeight',
  );
  if (flatEntries.length === 0) {
    return { ok: false, error: 'JSON must include a "fields" array or key-value pairs' };
  }

  return {
    ok: true,
    data: {
      title: typeof obj.title === 'string' ? obj.title : 'FormLens Document',
      template: typeof obj.template === 'string' ? obj.template : 'Custom JSON',
      date: typeof obj.date === 'string' ? obj.date : new Date().toLocaleDateString('en-IN'),
      fields: flatEntries.map(([k, v]) => ({
        key: k,
        label: k,
        value: v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v),
      })),
      notes: typeof obj.notes === 'string' ? obj.notes : undefined,
    },
  };
}

const FONT_FAMILY = '"Noto Sans Kannada", "Tunga", "Nudi", system-ui, -apple-system, sans-serif';

/** Word/character-aware wrapping for Kannada + English text on Canvas. */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [''];
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    const words = para.split(/(\s+)/);
    let current = '';
    for (const part of words) {
      const test = current + part;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current.trim()) lines.push(current.trimEnd());
        if (ctx.measureText(part.trimStart()).width > maxWidth) {
          let chunk = '';
          for (const ch of part.trimStart()) {
            if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          current = chunk;
        } else {
          current = part.trimStart();
        }
      }
    }
    if (current.trim() || lines.length === 0) {
      lines.push(current.trimEnd());
    }
  }
  return lines;
}

/**
 * Renders EditableFormJson in the exact spatial layout of the scanned image
 * (either on a clean white page or overlaid on the original photo with whiteout boxes).
 */
async function renderLayoutCanvas(
  data: EditableFormJson,
  backgroundImageUrl?: string,
): Promise<{ canvas: HTMLCanvasElement; pageWmm: number; pageHmm: number }> {
  const aspect =
    data.imageWidth && data.imageHeight && data.imageHeight > 0
      ? data.imageWidth / data.imageHeight
      : 210 / 297;

  const PAGE_W = 1240;
  const PAGE_H = Math.max(600, Math.min(2600, Math.round(PAGE_W / aspect)));

  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  if (backgroundImageUrl) {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load background image'));
      img.src = backgroundImageUrl;
    });
    ctx.drawImage(img, 0, 0, PAGE_W, PAGE_H);
  }

  for (const field of data.fields) {
    if (!field.normBbox) continue;
    const [nx0, ny0, nx1, ny1] = field.normBbox;
    const x = nx0 * PAGE_W;
    const y = ny0 * PAGE_H;
    const w = Math.max(20, (nx1 - nx0) * PAGE_W);
    const h = Math.max(14, (ny1 - ny0) * PAGE_H);

    if (backgroundImageUrl) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    }

    const text = (field.value ?? '').trim();
    if (!text) continue;

    // Auto-fit font size to box height, shrinking if needed so text fits inside box width
    let fontSize = Math.max(12, Math.min(54, Math.round(h * 0.72)));
    let lines: string[] = [text];
    while (fontSize > 11) {
      ctx.font = `500 ${fontSize}px ${FONT_FAMILY}`;
      lines = wrapCanvasText(ctx, text, Math.max(24, w));
      const totalTextH = lines.length * fontSize * 1.18;
      if (totalTextH <= h * 1.15) break;
      fontSize -= 2;
    }

    ctx.fillStyle = '#0f172a';
    ctx.font = `500 ${fontSize}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    const lineH = fontSize * 1.18;
    lines.forEach((line, i) => {
      ctx.fillText(line, x + 2, y + 2 + i * lineH, w);
    });
  }

  const pageWmm = 210;
  const pageHmm = Math.round((pageWmm / PAGE_W) * PAGE_H * 10) / 10;
  return { canvas, pageWmm, pageHmm };
}

async function renderPdfCanvases(
  data: EditableFormJson,
  options?: { mode?: PdfRenderMode; backgroundImageUrl?: string; applicantOnly?: boolean },
): Promise<{ pages: HTMLCanvasElement[]; pageWmm: number; pageHmm: number }> {
  const hasBoxes = data.fields.some((f) => Boolean(f.normBbox));
  const mode: PdfRenderMode = options?.mode ?? (hasBoxes ? 'layout' : 'table');

  if ((mode === 'layout' || mode === 'overlay') && hasBoxes) {
    const { canvas, pageWmm, pageHmm } = await renderLayoutCanvas(
      data,
      mode === 'overlay' ? options?.backgroundImageUrl : undefined,
    );
    return { pages: [canvas], pageWmm, pageHmm };
  }

  const applicantOnly = options?.applicantOnly ?? true;
  const tableFields = applicantOnly ? filterApplicantFields(data.fields) : data.fields;

  const PAGE_W = 1240;
  const PAGE_H = 1754;
  const MARGIN = 80;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const COL_LABEL_W = 380;
  const COL_VAL_W = applicantOnly ? CONTENT_W - COL_LABEL_W : CONTENT_W - COL_LABEL_W - 110;
  const COL_CONF_X = MARGIN + COL_LABEL_W + COL_VAL_W + 20;

  const pages: HTMLCanvasElement[] = [];

  const createPage = (pageNum: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; y: number } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    if (pageNum === 1) {
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 38px ${FONT_FAMILY}`;
      ctx.fillText(data.title || 'FormLens Document', MARGIN, MARGIN + 34);

      ctx.fillStyle = '#475569';
      ctx.font = `400 22px ${FONT_FAMILY}`;
      ctx.fillText(`Template: ${data.template}   •   Date: ${data.date}`, MARGIN, MARGIN + 74);

      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(MARGIN, MARGIN + 96);
      ctx.lineTo(PAGE_W - MARGIN, MARGIN + 96);
      ctx.stroke();

      return { canvas, ctx, y: MARGIN + 126 };
    }

    ctx.fillStyle = '#64748b';
    ctx.font = `400 20px ${FONT_FAMILY}`;
    ctx.fillText(`${data.title} (Page ${pageNum})`, MARGIN, MARGIN + 20);
    return { canvas, ctx, y: MARGIN + 54 };
  };

  const drawTableHeader = (ctx: CanvasRenderingContext2D, y: number): number => {
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(MARGIN, y, CONTENT_W, 48);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(MARGIN, y, CONTENT_W, 48);

    ctx.fillStyle = '#0f172a';
    ctx.font = `700 22px ${FONT_FAMILY}`;
    ctx.fillText('Field / ಕ್ಷೇತ್ರ', MARGIN + 16, y + 32);
    ctx.fillText(
      applicantOnly ? 'Applicant Detail / ಅರ್ಜಿದಾರರ ವಿವರ' : 'Extracted Value / ಮೌಲ್ಯ',
      MARGIN + COL_LABEL_W + 16,
      y + 32,
    );
    if (!applicantOnly) {
      ctx.fillText('Conf', COL_CONF_X, y + 32);
    }
    return y + 48;
  };

  let { canvas, ctx, y } = createPage(1);
  pages.push(canvas);
  y = drawTableHeader(ctx, y);

  const LINE_H = 32;
  const PAD_Y = 16;

  for (const field of tableFields) {
    ctx.font = `600 22px ${FONT_FAMILY}`;
    const labelLines = wrapCanvasText(ctx, field.label || field.key, COL_LABEL_W - 28);
    ctx.font = `400 22px ${FONT_FAMILY}`;
    const valueLines = wrapCanvasText(ctx, field.value || '—', COL_VAL_W - 28);

    const rowLines = Math.max(labelLines.length, valueLines.length, 1);
    const rowH = rowLines * LINE_H + PAD_Y * 2;

    if (y + rowH > PAGE_H - MARGIN - 40) {
      const next = createPage(pages.length + 1);
      canvas = next.canvas;
      ctx = next.ctx;
      pages.push(canvas);
      y = drawTableHeader(ctx, next.y);
    }

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN, y, CONTENT_W, rowH);

    ctx.fillStyle = '#1e293b';
    ctx.font = `600 22px ${FONT_FAMILY}`;
    labelLines.forEach((line, i) => {
      ctx.fillText(line, MARGIN + 16, y + PAD_Y + 24 + i * LINE_H);
    });

    ctx.fillStyle = '#0f172a';
    ctx.font = `400 22px ${FONT_FAMILY}`;
    valueLines.forEach((line, i) => {
      ctx.fillText(line, MARGIN + COL_LABEL_W + 16, y + PAD_Y + 24 + i * LINE_H);
    });

    if (!applicantOnly && field.confidence !== undefined) {
      ctx.fillStyle = field.confidence >= 85 ? '#15803d' : field.confidence >= 60 ? '#b45309' : '#b91c1c';
      ctx.font = `600 20px ${FONT_FAMILY}`;
      ctx.fillText(`${Math.round(field.confidence)}%`, COL_CONF_X, y + PAD_Y + 24);
    }

    y += rowH;
  }

  if (data.notes && data.notes.trim()) {
    ctx.font = `400 22px ${FONT_FAMILY}`;
    const noteLines = wrapCanvasText(ctx, data.notes.trim(), CONTENT_W - 32);
    const notesH = noteLines.length * LINE_H + 64;
    if (y + notesH > PAGE_H - MARGIN) {
      const next = createPage(pages.length + 1);
      canvas = next.canvas;
      ctx = next.ctx;
      pages.push(canvas);
      y = next.y;
    } else {
      y += 28;
    }
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 22px ${FONT_FAMILY}`;
    ctx.fillText('Notes / ಟಿಪ್ಪಣಿ:', MARGIN, y + 24);
    ctx.font = `400 22px ${FONT_FAMILY}`;
    ctx.fillStyle = '#334155';
    noteLines.forEach((line, i) => {
      ctx.fillText(line, MARGIN, y + 58 + i * LINE_H);
    });
  }

  return { pages, pageWmm: 210, pageHmm: 297 };
}

/**
 * Renders JPEG data URLs for each page so users can preview the exact PDF before exporting.
 */
export async function renderPdfPreviewDataUrls(
  data: EditableFormJson,
  options?: { mode?: PdfRenderMode; backgroundImageUrl?: string; applicantOnly?: boolean },
): Promise<string[]> {
  const { pages } = await renderPdfCanvases(data, options);
  return pages.map((pg) => pg.toDataURL('image/jpeg', 0.88));
}

/**
 * Renders EditableFormJson onto A4/layout-matched HTML Canvas pages
 * and saves a multi-page PDF. Defaults to layout-matching mode if normBbox coordinates exist.
 */
export async function exportJsonToPdf(
  data: EditableFormJson,
  filename = 'formlens-document.pdf',
  options?: { mode?: PdfRenderMode; backgroundImageUrl?: string; applicantOnly?: boolean },
): Promise<void> {
  const { pages, pageWmm, pageHmm } = await renderPdfCanvases(data, options);
  const doc = new jsPDF({
    orientation: pageWmm > pageHmm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [pageWmm, pageHmm],
  });
  pages.forEach((pg, idx) => {
    if (idx > 0) doc.addPage([pageWmm, pageHmm]);
    const imgData = pg.toDataURL('image/jpeg', 0.94);
    doc.addImage(imgData, 'JPEG', 0, 0, pageWmm, pageHmm);
  });

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export function downloadEditableJson(rawJson: string, filename = 'formlens-editable.json'): void {
  const blob = new Blob([rawJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
