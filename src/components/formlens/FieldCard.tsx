/**
 * FieldCard — editable review card for a single OCR result.
 */
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Check } from 'lucide-react';
import { ConfidenceBadge, confidenceColor } from './ConfidenceBadge';
import { validateField } from '@/lib/formlens/validators';
import { validatePincode } from '@/lib/formlens/validators';
import { snapLocality } from '@/lib/formlens/fuzzySnap';
import type { FieldType } from '@/config/model';

interface Props {
  fieldId: string;
  labelEn: string;
  labelKn: string;
  fieldType: FieldType;
  value: string;
  confidence: number;
  cropDataUrl?: string;
  onValueChange: (value: string) => void;
  onAccept: () => void;
  accepted: boolean;
  warnings?: string[];
}

export function FieldCard({
  fieldId,
  labelEn,
  labelKn,
  fieldType,
  value,
  confidence,
  cropDataUrl,
  onValueChange,
  onAccept,
  accepted,
  warnings = [],
}: Props) {
  const [localValue, setLocalValue] = useState(value);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    // Validate
    const isPincode = fieldId.toLowerCase().includes('pin');
    const err = isPincode ? validatePincode(localValue) : validateField(localValue, fieldType);
    setValidationError(err);

    // Fuzzy snap for text/name fields (locality fields)
    const isLocality = ['district', 'taluk', 'village'].some((k) => fieldId.toLowerCase().includes(k));
    if (isLocality && localValue.trim()) {
      snapLocality(localValue).then((snap) => {
        if (snap && snap.value !== localValue) {
          setSuggestion(snap.value);
        } else {
          setSuggestion(null);
        }
      }).catch(() => setSuggestion(null));
    } else {
      setSuggestion(null);
    }
  }, [localValue, fieldType, fieldId]);

  const handleChange = (v: string) => {
    setLocalValue(v);
    onValueChange(v);
  };

  const handleSuggestion = () => {
    if (suggestion) {
      handleChange(suggestion);
      setSuggestion(null);
    }
  };

  const hasWarnings = warnings.length > 0;

  return (
    <Card
      className={`border-2 transition-colors ${
        hasWarnings
          ? 'border-amber-400 bg-amber-50/40 dark:bg-amber-950/15'
          : accepted
            ? 'border-green-300'
            : confidenceColor(confidence)
      }`}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: label + confidence */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-foreground">{labelEn}</div>
            <div className="text-xs text-muted-foreground">{labelKn}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ConfidenceBadge confidence={confidence} />
            {accepted && (
              <span className="rounded-full bg-green-100 p-0.5 text-green-700">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </div>

        {/* Crop image if available */}
        {cropDataUrl && (
          <div className="rounded border border-border overflow-hidden h-10">
            <img src={cropDataUrl} alt="Field crop" className="h-full object-cover w-full" />
          </div>
        )}

        {/* Editable value */}
        {fieldType === 'checkbox' ? (
          <div className="flex gap-3">
            {['yes', 'no'].map((opt) => (
              <button
                key={opt}
                onClick={() => handleChange(opt)}
                className={`flex-1 rounded-md border py-2 text-sm font-medium transition-colors capitalize
                  ${localValue === opt ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted'}`}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <Input
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            className={validationError ? 'border-red-400' : ''}
          />
        )}

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-red-600">{validationError}</p>
        )}

        {/* Name / edge-case warnings */}
        {hasWarnings && (
          <div className="rounded-md bg-amber-50 border border-amber-300 px-2.5 py-1.5 space-y-1">
            {warnings.map((w, idx) => (
              <div key={idx} className="flex items-start gap-1.5 text-xs text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Suggestion */}
        {suggestion && (
          <div className="flex items-center gap-2 rounded-md bg-blue-50 border border-blue-200 px-2 py-1.5">
            <span className="text-xs text-blue-700">Suggestion: <strong>{suggestion}</strong></span>
            <Button size="sm" variant="ghost" className="h-6 text-xs text-blue-700 hover:bg-blue-100 ml-auto px-2" onClick={handleSuggestion}>
              Apply
            </Button>
          </div>
        )}

        {/* Accept button */}
        {!accepted && (
          <Button size="sm" variant="outline" className="w-full" onClick={onAccept}>
            <Check className="h-3.5 w-3.5 mr-1" /> Accept
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

