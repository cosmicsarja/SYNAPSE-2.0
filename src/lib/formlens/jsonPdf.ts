/**
 * Editable JSON <-> Kannada/English PDF converter.
 * Renders via high-DPI HTML Canvas into A4 jsPDF pages so Kannada Unicode
 * glyphs, vowel signs, and ottaksharas shape accurately 100% offline.
 */
import { jsPDF } from 'jspdf';
import type { FormField, SavedForm } from '@/db/schema';

export interface EditableJsonField {
  key: string;
  label: string;
  value: string;
  confidence?: number;
}

export interface EditableFormJson {
  title: string;
  template: string;
  date: string;
  fields: EditableJsonField[];
  notes?: string;
}

/**
 * Converts a scanned form and its fields into a clean editable JSON structure.
 */
export function formToEditableJson(form: SavedForm, fields: FormField[]): EditableFormJson {
  return {
    title: `FormLens Extract #${form.id ?? 'new'}`,
    template: form.templateName || 'Auto Extract',
    date: new Date(form.createdAt).toLocaleDateString('en-IN'),
    fields: fields.map((f, idx) => ({
      key: f.fieldId || `field_${idx + 1}`,
      label: f.labelKn && f.labelKn !== f.labelEn ? `${f.labelEn} / ${f.labelKn}` : f.labelEn,
      value: f.textValue ?? '',
      confidence: Math.round((f.confidence ?? 0) * 100),
    })),
    notes: '',
  };
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
      return confidence !== undefined ? { key, label, value, confidence } : { key, label, value };
    });

    return {
      ok: true,
      data: {
        title: typeof obj.title === 'string' && obj.title.trim() ? obj.title : 'FormLens Document',
        template: typeof obj.template === 'string' ? obj.template : 'Custom JSON',
        date: typeof obj.date === 'string' ? obj.date : new Date().toLocaleDateString('en-IN'),
        fields,
        notes: typeof obj.notes === 'string' ? obj.notes : undefined,
      },
    };
  }

  // Flat key-value JSON object support: { "ಹೆಸರು": "ರಮೇಶ್", "Mobile": "9876543210" }
  const flatEntries = Object.entries(obj).filter(
    ([k]) => k !== 'title' && k !== 'template' && k !== 'date' && k !== 'notes',
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

/** Word/character-aware wrapping for Kannada + English text on Canvas. */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return ['—'];
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
        // If a single long token exceeds maxWidth, break by character
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
 * Renders EditableFormJson onto A4-proportioned HTML Canvas pages (1240x1754, ~150 DPI)
 * and saves a multi-page PDF with crisp native Kannada & English typography.
 */
export function exportJsonToPdf(
  data: EditableFormJson,
  filename = `formlens-document.pdf`,
): void {
  const PAGE_W = 1240;
  const PAGE_H = 1754;
  const MARGIN = 80;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const COL_LABEL_W = 360;
  const COL_VAL_W = CONTENT_W - COL_LABEL_W - 110;
  const COL_CONF_X = MARGIN + COL_LABEL_W + COL_VAL_W + 20;
  const FONT_FAMILY = '"Noto Sans Kannada", "Tunga", "Nudi", system-ui, -apple-system, sans-serif';

  const pages: HTMLCanvasElement[] = [];

  const createPage = (pageNum: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; y: number } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    if (pageNum === 1) {
      // Title
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 38px ${FONT_FAMILY}`;
      ctx.fillText(data.title || 'FormLens Document', MARGIN, MARGIN + 34);

      // Metadata line
      ctx.fillStyle = '#475569';
      ctx.font = `400 22px ${FONT_FAMILY}`;
      ctx.fillText(`Template: ${data.template}   •   Date: ${data.date}`, MARGIN, MARGIN + 74);

      // Divider
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
    ctx.fillText('Extracted Value / ಮೌಲ್ಯ', MARGIN + COL_LABEL_W + 16, y + 32);
    ctx.fillText('Conf', COL_CONF_X, y + 32);
    return y + 48;
  };

  let { canvas, ctx, y } = createPage(1);
  pages.push(canvas);
  y = drawTableHeader(ctx, y);

  const LINE_H = 32;
  const PAD_Y = 16;

  for (const field of data.fields) {
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

    // Row border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN, y, CONTENT_W, rowH);

    // Label column
    ctx.fillStyle = '#1e293b';
    ctx.font = `600 22px ${FONT_FAMILY}`;
    labelLines.forEach((line, i) => {
      ctx.fillText(line, MARGIN + 16, y + PAD_Y + 24 + i * LINE_H);
    });

    // Value column
    ctx.fillStyle = '#0f172a';
    ctx.font = `400 22px ${FONT_FAMILY}`;
    valueLines.forEach((line, i) => {
      ctx.fillText(line, MARGIN + COL_LABEL_W + 16, y + PAD_Y + 24 + i * LINE_H);
    });

    // Confidence column
    if (field.confidence !== undefined) {
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

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  pages.forEach((pg, idx) => {
    if (idx > 0) doc.addPage();
    const imgData = pg.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgData, 'JPEG', 0, 0, 210, 297);
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
