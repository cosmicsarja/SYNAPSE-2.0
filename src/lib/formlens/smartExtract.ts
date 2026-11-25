/**
 * Smart form field extraction from full-page OCR lines.
 * Maps detected lines to template fields using bilingual label matching,
 * regex patterns (phone, date, pincode), and Karnataka locality fuzzy matching.
 */
import type { TemplateField } from '@/components/formlens/TemplatePicker';
import type { FullPageOcrResult, OcrLine } from '@/workers/tesseract-engine';
import { snapLocality } from '@/lib/formlens/fuzzySnap';

export interface ExtractedFieldResult {
  text: string;
  confidence: number;
  cropDataUrl: string;
}

const LABEL_KEYWORDS: Record<string, string[]> = {
  applicant_name: ['applicant name', 'full name', 'name', 'ಹೆಸರು', 'ಅರ್ಜಿದಾರರ'],
  father_name: ["father's name", 'father name', 'father', 'ತಂದೆಯ ಹೆಸರು', 'ತಂದೆಯ'],
  dob: ['date of birth', 'dob', 'birth', 'ದಿನಾಂಕ', 'ಜನ್ಮ'],
  phone: ['mobile', 'phone', 'contact', 'ಮೊಬೈಲ್', 'ಸಂಪರ್ಕ'],
  district: ['district', 'ಜಿಲ್ಲೆ'],
  taluk: ['taluk', 'taluka', 'ತಾಲ್ಲೂಕು'],
  village: ['village', 'town', 'city', 'place', 'ಗ್ರಾಮ', 'ಪಟ್ಟಣ'],
  pincode: ['pincode', 'pin code', 'pin', 'ಅಂಚೆ'],
  annual_income: ['annual income', 'income', 'ಆದಾಯ'],
  family_members: ['family members', 'members', 'ಕುಟುಂಬ'],
  bpl_card: ['bpl', 'ಬಿಪಿಎಲ್'],
};

function cropLineToDataUrl(srcCanvas: HTMLCanvasElement, line: OcrLine): string {
  const x = Math.max(0, line.bbox.x0 - 4);
  const y = Math.max(0, line.bbox.y0 - 4);
  const w = Math.max(1, Math.min(srcCanvas.width - x, line.bbox.x1 - line.bbox.x0 + 8));
  const h = Math.max(1, Math.min(srcCanvas.height - y, line.bbox.y1 - line.bbox.y0 + 8));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.75);
}

function stripLabelPrefix(lineText: string, keywords: string[]): string {
  // Split on ":" or "-" if present
  const colonIdx = lineText.indexOf(':');
  if (colonIdx !== -1) {
    return lineText.slice(colonIdx + 1).trim();
  }
  const lower = lineText.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx !== -1) {
      const rest = lineText.slice(idx + kw.length).replace(/^[\s\-:]+/, '').trim();
      if (rest) return rest;
    }
  }
  return '';
}

export async function extractFieldsFromPage(
  ocr: FullPageOcrResult,
  fields: TemplateField[],
  croppedImageData: ImageData,
  fallbackThumbnailUrl: string,
): Promise<Map<string, ExtractedFieldResult>> {
  const results = new Map<string, ExtractedFieldResult>();
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = croppedImageData.width;
  srcCanvas.height = croppedImageData.height;
  srcCanvas.getContext('2d')!.putImageData(croppedImageData, 0, 0);

  const usedLineIndices = new Set<number>();

  for (const field of fields) {
    if (field.id === 'extracted_text') {
      results.set(field.id, {
        text: ocr.fullText,
        confidence: ocr.confidence,
        cropDataUrl: fallbackThumbnailUrl,
      });
      continue;
    }

    const keywords = LABEL_KEYWORDS[field.id] ?? [field.labelEn.toLowerCase()];
    let matchedText = '';
    let matchedConf = 0;
    let matchedLineIdx = -1;

    // 1. Try label-based extraction
    for (let i = 0; i < ocr.lines.length; i++) {
      const line = ocr.lines[i];
      if (!line) continue;
      const lower = line.text.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        const inlineVal = stripLabelPrefix(line.text, keywords);
        if (inlineVal) {
          matchedText = inlineVal;
          matchedConf = line.confidence;
          matchedLineIdx = i;
          break;
        }
        // Value might be on the very next line
        const nextLine = ocr.lines[i + 1];
        if (nextLine && !usedLineIndices.has(i + 1)) {
          matchedText = nextLine.text.trim();
          matchedConf = nextLine.confidence;
          matchedLineIdx = i + 1;
          break;
        }
      }
    }

    // 2. Pattern-based fallback if label didn't match
    if (!matchedText) {
      if (field.type === 'phone') {
        for (let i = 0; i < ocr.lines.length; i++) {
          const line = ocr.lines[i]!;
          const digits = line.text.replace(/[\s\-()]/g, '');
          const m = digits.match(/(?:\+91)?([6-9]\d{9})/);
          if (m?.[1]) {
            matchedText = m[1];
            matchedConf = line.confidence;
            matchedLineIdx = i;
            break;
          }
        }
      } else if (field.type === 'date') {
        for (let i = 0; i < ocr.lines.length; i++) {
          const line = ocr.lines[i]!;
          const m = line.text.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/);
          if (m) {
            matchedText = m[0];
            matchedConf = line.confidence;
            matchedLineIdx = i;
            break;
          }
        }
      } else if (field.id.includes('pin')) {
        for (let i = 0; i < ocr.lines.length; i++) {
          const line = ocr.lines[i]!;
          const m = line.text.match(/\b5[6-9]\d{4}\b/) ?? line.text.match(/\b\d{6}\b/);
          if (m) {
            matchedText = m[0];
            matchedConf = line.confidence;
            matchedLineIdx = i;
            break;
          }
        }
      } else if (['district', 'taluk', 'village'].includes(field.id)) {
        for (let i = 0; i < ocr.lines.length; i++) {
          const line = ocr.lines[i]!;
          const snap = await snapLocality(line.text, 0.25);
          if (snap) {
            matchedText = snap.value;
            matchedConf = line.confidence;
            matchedLineIdx = i;
            break;
          }
        }
      } else if (field.type === 'name' && ocr.lines.length > 0) {
        // First unclaimed line with letters
        for (let i = 0; i < ocr.lines.length; i++) {
          if (usedLineIndices.has(i)) continue;
          const line = ocr.lines[i]!;
          if (/[a-zA-Z\u0C80-\u0CFF]{2,}/.test(line.text)) {
            matchedText = line.text.trim();
            matchedConf = line.confidence;
            matchedLineIdx = i;
            break;
          }
        }
      }
    }

    if (matchedLineIdx >= 0) usedLineIndices.add(matchedLineIdx);

    const cropDataUrl =
      matchedLineIdx >= 0 && ocr.lines[matchedLineIdx]
        ? cropLineToDataUrl(srcCanvas, ocr.lines[matchedLineIdx]!)
        : fallbackThumbnailUrl;

    results.set(field.id, {
      text: matchedText,
      confidence: matchedText ? matchedConf : 0,
      cropDataUrl,
    });
  }

  return results;
}
