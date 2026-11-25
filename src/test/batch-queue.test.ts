import { describe, expect, it } from 'vitest';
import { inferFieldType } from '@/lib/formlens/saveScannedForm';
import type { BatchQueueItem } from '@/db/schema';

function recoverStuckReading(items: BatchQueueItem[]): BatchQueueItem[] {
  return items.map((it) =>
    it.status === 'reading' ? { ...it, status: 'queued' } : it,
  );
}

describe('Batch scanning helpers', () => {
  it('infers field types accurately for phone, date, number, and text', () => {
    expect(inferFieldType('+91 9876543210')).toBe('phone');
    expect(inferFieldType('12/05/2025')).toBe('date');
    expect(inferFieldType('560001')).toBe('number');
    expect(inferFieldType('ರಮೇಶ್ ಕುಮಾರ್')).toBe('text');
  });

  it('recovers interrupted reading items back to queued on restart', () => {
    const queue: BatchQueueItem[] = [
      {
        id: 1,
        imageDataUrl: 'data:image/jpeg;base64,a',
        width: 100,
        height: 100,
        scanMode: 'template',
        templateId: 'ration-card',
        langMode: 'eng+kan',
        status: 'ready',
        formId: 42,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 2,
        imageDataUrl: 'data:image/jpeg;base64,b',
        width: 100,
        height: 100,
        scanMode: 'template',
        templateId: 'ration-card',
        langMode: 'eng+kan',
        status: 'reading',
        createdAt: 3,
        updatedAt: 4,
      },
      {
        id: 3,
        imageDataUrl: 'data:image/jpeg;base64,c',
        width: 100,
        height: 100,
        scanMode: 'template',
        templateId: 'ration-card',
        langMode: 'eng+kan',
        status: 'queued',
        createdAt: 5,
        updatedAt: 5,
      },
    ];

    const recovered = recoverStuckReading(queue);
    expect(recovered[0]!.status).toBe('ready');
    expect(recovered[1]!.status).toBe('queued');
    expect(recovered[2]!.status).toBe('queued');
  });
});
