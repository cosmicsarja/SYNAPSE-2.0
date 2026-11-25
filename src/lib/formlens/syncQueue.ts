/**
 * Background sync queue.
 * Uploads forms to Supabase when online; retries with exponential backoff.
 * Never blocks the UI.
 */
import { db } from '@/db';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

let syncRunning = false;

export async function enqueueSyncForm(formId: number): Promise<void> {
  await db.syncQueue.add({
    formId,
    createdAt: Date.now(),
    retryCount: 0,
  });
  triggerSync();
}

export function triggerSync(): void {
  if (syncRunning) return;
  if (!navigator.onLine) return;
  void runSync();
}

async function runSync(): Promise<void> {
  syncRunning = true;
  try {
    const items = await db.syncQueue.orderBy('createdAt').toArray();
    for (const item of items) {
      if (!navigator.onLine) break;
      if (item.retryCount >= MAX_RETRIES) {
        // Give up after max retries
        if (item.id !== undefined) await db.syncQueue.delete(item.id);
        continue;
      }
      try {
        await uploadForm(item.formId);
        if (item.id !== undefined) await db.syncQueue.delete(item.id);
      } catch (err) {
        const delay = BASE_DELAY_MS * Math.pow(2, item.retryCount);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (item.id !== undefined) {
          await db.syncQueue.update(item.id, {
            retryCount: item.retryCount + 1,
            lastError: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } finally {
    syncRunning = false;
  }
}

async function uploadForm(formId: number): Promise<void> {
  // Dynamically import Supabase only when online
  const { supabase } = await import('@/integrations/supabase/client');
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return; // not signed in — keep in queue

  const form = await db.forms.get(formId);
  if (!form) return;
  const fields = await db.formFields.where('formId').equals(formId).toArray();

  // Upsert form
  const { data: formRow, error: formErr } = await supabase.from('forms' as never).upsert({
    id: form.supabaseId,
    user_id: session.session.user.id,
    template_id: form.templateId,
    status: form.status,
    avg_confidence: form.avgConfidence,
    created_at: new Date(form.createdAt).toISOString(),
    updated_at: new Date(form.updatedAt).toISOString(),
  }).select('id').single();

  if (formErr) throw formErr;

  const supabaseFormId = (formRow as { id: string }).id;

  // Upsert fields
  const fieldRows = fields.map((f) => ({
    form_id: supabaseFormId,
    field_name: f.fieldId,
    text_value: f.textValue,
    confidence: f.confidence,
    was_edited: f.wasEdited,
    original_text: f.originalText,
  }));

  const { error: fieldsErr } = await supabase.from('form_fields' as never).upsert(fieldRows);
  if (fieldsErr) throw fieldsErr;

  // Mark form as synced
  await db.forms.update(formId, {
    supabaseId: supabaseFormId,
    status: 'synced',
    updatedAt: Date.now(),
  });
}

// Auto-trigger on network restoration
if (typeof window !== 'undefined') {
  window.addEventListener('online', triggerSync);
}

