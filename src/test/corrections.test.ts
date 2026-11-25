import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildCorrectionsDatasetZip } from '@/lib/formlens/corrections';
import type { CorrectionRecord } from '@/db/schema';

describe('Corrections dataset ZIP export', () => {
  it('generates crops/*.png and labels.csv with escaped CSV fields', async () => {
    const fakePng1 = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: 'image/png',
    });
    const records: CorrectionRecord[] = [
      {
        id: 1,
        formId: 10,
        fieldName: 'applicant_name',
        originalText: 'Ramesh, K',
        correctedText: 'Ramesh "Kumar"',
        confidence: 0.72,
        cropBlob: fakePng1,
        templateId: 'ration-card',
        timestamp: 1700000000000,
      },
      {
        id: 2,
        formId: 10,
        fieldName: 'name_kn',
        originalText: 'ರಮಶ್',
        correctedText: 'ರಮೇಶ್',
        confidence: 0.85,
        templateId: 'ration-card',
        timestamp: 1700000005000,
      },
    ];

    const zipBlob = await buildCorrectionsDatasetZip(records);
    const loaded = await JSZip.loadAsync(zipBlob);

    const csvFile = loaded.file('labels.csv');
    expect(csvFile).not.toBeNull();
    const csvText = await csvFile!.async('string');
    const lines = csvText.split('\n');

    expect(lines[0]).toBe('filename,corrected_text,original_text,confidence');
    expect(lines[1]).toBe('crops/crop_0001.png,"Ramesh ""Kumar""","Ramesh, K",0.7200');
    expect(lines[2]).toBe(',ರಮೇಶ್,ರಮಶ್,0.8500');

    const cropFile = loaded.file('crops/crop_0001.png');
    expect(cropFile).not.toBeNull();
    const bytes = await cropFile!.async('uint8array');
    expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });
});
