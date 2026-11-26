import { describe, it, expect } from 'vitest';
import { parseGeminiOcrResponse } from '@/workers/gemini-engine';

describe('Gemini Vision OCR response parser', () => {
  it('parses Kannada and English blocks with normalized 0..1000 box_2d into pixel bboxes', () => {
    const raw = JSON.stringify({
      blocks: [
        {
          text: 'ಹೆಸರು: ರಮೇಶ್-',
          script: 'kn',
          confidence: 0.96,
          box_2d: [100, 50, 160, 450],
        },
        {
          text: 'Mobile: 9876543210',
          script: 'en',
          confidence: 98,
          box_2d: [200, 50, 250, 500],
        },
      ],
    });

    const result = parseGeminiOcrResponse(raw, 1000, 2000);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.text).toBe('ಹೆಸರು: ರಮೇಶ್');
    expect(result.lines[0]!.language).toBe('kn');
    expect(result.lines[0]!.confidence).toBeCloseTo(0.96, 4);
    expect(result.lines[0]!.bbox).toEqual({ x0: 50, y0: 200, x1: 450, y1: 320 });

    expect(result.lines[1]!.text).toBe('Mobile: 9876543210');
    expect(result.lines[1]!.confidence).toBeCloseTo(0.98, 4);
    expect(result.lines[1]!.bbox).toEqual({ x0: 50, y0: 400, x1: 500, y1: 500 });
    expect(result.fullText).toBe('ಹೆಸರು: ರಮೇಶ್\nMobile: 9876543210');
  });

  it('strips markdown code fences and throws a clear error on invalid JSON', () => {
    const fenced = '```json\n{"blocks":[{"text":"ಕರ್ನಾಟಕ","box_2d":[0,0,100,200]}]}\n```';
    const parsed = parseGeminiOcrResponse(fenced, 500, 500);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]!.text).toBe('ಕರ್ನಾಟಕ');

    expect(() => parseGeminiOcrResponse('not json', 500, 500)).toThrow(/non-JSON/i);
  });

  it('parses structured fields into label : value fullText and preserves labels', () => {
    const raw = JSON.stringify({
      fields: [
        {
          label: 'Name (Kannada)',
          value: 'ರೋಹನ್ ಕುಮಾರ್',
          script: 'kn',
          confidence: 0.97,
          box_2d: [250, 390, 285, 740],
        },
        {
          label: 'Name (English)',
          value: 'ROHAN KUMAR',
          script: 'en',
          confidence: 0.99,
          box_2d: [365, 390, 400, 720],
        },
        {
          label: 'Mobile No',
          value: '9845123490',
          script: 'number',
          confidence: 0.99,
          box_2d: [585, 480, 610, 800],
        },
      ],
    });

    const parsed = parseGeminiOcrResponse(raw, 1000, 1400);
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines[0]!.label).toBe('Name (Kannada)');
    expect(parsed.lines[0]!.text).toBe('ರೋಹನ್ ಕುಮಾರ್');
    expect(parsed.fullText).toBe(
      'Name (Kannada) : ರೋಹನ್ ಕುಮಾರ್\nName (English) : ROHAN KUMAR\nMobile No : 9845123490',
    );
  });
});
