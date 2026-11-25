/**
 * MockOcrEngine — works in demo mode without any model files.
 * Returns plausible-looking text with realistic confidence scores.
 */
import type { OcrEngine, OcrResult, FieldType } from '@/config/model';

const MOCK_VALUES: Record<string, string[]> = {
  name: ['Ramesh Kumar', 'Priya Devi', 'Suresh Nayak', 'Anjali Reddy', 'Mohan Das'],
  date: ['15/08/1985', '01/01/1990', '12/06/1978', '25/03/2000'],
  phone: ['9876543210', '8765432109', '7654321098', '9988776655'],
  number: ['4', '125000', '560001', '3', '2'],
  text: ['Bengaluru Urban', 'Mysuru', 'Bengaluru North', 'Jayanagar', '560041'],
  checkbox: ['yes', 'no'],
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function detectScript(text: string): OcrResult['script'] {
  const hasKannada = /[\u0C80-\u0CFF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasKannada && hasLatin) return 'mixed';
  if (hasKannada) return 'kn';
  return 'en';
}

export class MockOcrEngine implements OcrEngine {
  async init(): Promise<void> {
    // No-op — mock is always ready
    await sleep(50);
  }

  async recognize(crop: ImageData, fieldType: FieldType): Promise<OcrResult> {
    // Simulate processing time
    await sleep(100 + Math.random() * 200);

    const pool = MOCK_VALUES[fieldType] ?? MOCK_VALUES['text'];
    if (!pool) return { text: '', confidence: 0.5, script: 'en' };
    const text = pick(pool);
    // Mock confidence: 70-99%
    const confidence = 0.70 + Math.random() * 0.29;

    return {
      text,
      confidence,
      script: detectScript(text),
    };
  }
}

