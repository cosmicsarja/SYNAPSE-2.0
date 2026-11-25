/**
 * Review route — editable field-by-field OCR review with exports.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { FieldCard } from '@/components/formlens/FieldCard';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { ConfidenceBadge } from '@/components/formlens/ConfidenceBadge';
import { getFormWithFields, updateFormField, markFormReviewed, db } from '@/db';
import type { SavedForm, FormField } from '@/db/schema';
import type { FieldType } from '@/config/model';
import { exportJson, exportCsv, exportPdf } from '@/lib/formlens/exports';
import { enqueueSyncForm } from '@/lib/formlens/syncQueue';
import { ChevronLeft, Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const Route = createFileRoute('/review/$id')({
  head: () => ({ meta: [{ title: 'Review – FormLens' }] }),
  component: ReviewPage,
});

function ReviewPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const formId = parseInt(id, 10);

  const [form, setForm] = useState<SavedForm | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFormWithFields(formId).then((result) => {
      if (result) {
        setForm(result.form);
        setFields(result.fields);
      }
      setLoading(false);
    });
  }, [formId]);

  const handleValueChange = useCallback(async (fieldId: number, value: string) => {
    setFields((prev) => prev.map((f) => f.id === fieldId ? { ...f, textValue: value, wasEdited: true } : f));
    if (fieldId !== undefined) {
      await updateFormField(fieldId, value);
    }
  }, []);

  const handleAccept = useCallback((fieldId: number) => {
    setAccepted((prev) => new Set([...prev, fieldId]));
  }, []);

  const handleAcceptAll = () => {
    setAccepted(new Set(fields.map((f) => f.id!).filter((id) => id !== undefined)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedFields = await db.formFields.where('formId').equals(formId).toArray();
      const avg = updatedFields.reduce((s, f) => s + f.confidence, 0) / (updatedFields.length || 1);
      await markFormReviewed(formId, avg);
      await enqueueSyncForm(formId);
      void navigate({ to: '/forms' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Form not found</div>
      </div>
    );
  }

  // Split fields: low confidence first
  const needsReview = fields.filter((f) => f.confidence < 0.60 && !accepted.has(f.id!));
  const others = fields.filter((f) => f.confidence >= 0.60 || accepted.has(f.id!));

  const avgConf = fields.reduce((s, f) => s + f.confidence, 0) / (fields.length || 1);

  return (
    <div className="flex h-screen flex-col bg-background">
      <OfflineStatusBar />

      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => void navigate({ to: '/forms' })}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{form.templateName}</div>
          <div className="text-xs text-muted-foreground">
            {fields.length} fields · <ConfidenceBadge confidence={avgConf} />
          </div>
        </div>
        {/* Export dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportJson(form, fields)}>
              Export JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportCsv(form, fields)}>
              Export CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportPdf(form, fields)}>
              Export PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 pb-36">

        {needsReview.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-red-600 uppercase mb-3">
              ⚠ Needs Review ({needsReview.length})
            </h2>
            <div className="space-y-3">
              {needsReview.map((field) => (
                <FieldCard
                  key={field.id}
                  fieldId={field.fieldId}
                  labelEn={field.labelEn}
                  labelKn={field.labelKn}
                  fieldType={field.fieldType as FieldType}
                  value={field.textValue}
                  confidence={field.confidence}
                  cropDataUrl={field.cropDataUrl}
                  onValueChange={(v) => void handleValueChange(field.id!, v)}
                  onAccept={() => handleAccept(field.id!)}
                  accepted={accepted.has(field.id!)}
                />
              ))}
            </div>
          </section>
        )}

        {others.length > 0 && (
          <section>
            {needsReview.length > 0 && (
              <h2 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                Other Fields
              </h2>
            )}
            <div className="space-y-3">
              {others.map((field) => (
                <FieldCard
                  key={field.id}
                  fieldId={field.fieldId}
                  labelEn={field.labelEn}
                  labelKn={field.labelKn}
                  fieldType={field.fieldType as FieldType}
                  value={field.textValue}
                  confidence={field.confidence}
                  cropDataUrl={field.cropDataUrl}
                  onValueChange={(v) => void handleValueChange(field.id!, v)}
                  onAccept={() => handleAccept(field.id!)}
                  accepted={accepted.has(field.id!)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background px-4 py-3 flex gap-3 pb-safe">
        <Button variant="outline" onClick={handleAcceptAll} className="flex-1" disabled={accepted.size === fields.length}>
          Accept All
        </Button>
        <Button onClick={handleSave} className="flex-1" disabled={saving}>
          {saving ? 'Saving…' : 'Save & Done'}
        </Button>
      </div>
    </div>
  );
}

