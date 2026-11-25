/**
 * Field validators for FormLens review screen.
 * Returns null if valid, or an error message string if invalid.
 */

import type { FieldType } from '@/config/model';

export function validateField(value: string, fieldType: FieldType): string | null {
  const v = value.trim();
  if (!v) return null; // empty is allowed (user may leave blank)

  switch (fieldType) {
    case 'date': {
      // Accept DD/MM/YYYY or DD-MM-YYYY
      const datePattern = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
      const m = datePattern.exec(v);
      if (!m) return 'Invalid date format (use DD/MM/YYYY)';
      const day = parseInt(m[1] ?? '0', 10);
      const month = parseInt(m[2] ?? '0', 10);
      const year = parseInt(m[3] ?? '0', 10);
      if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
        return 'Invalid date format (use DD/MM/YYYY)';
      }
      return null;
    }

    case 'phone': {
      // 10-digit Indian mobile number, optionally starting with +91
      const phone = v.replace(/[\s\-\(\)]/g, '').replace(/^\+91/, '');
      if (!/^\d{10}$/.test(phone)) {
        return 'Enter a valid 10-digit mobile number';
      }
      return null;
    }

    case 'number': {
      // Generic numeric field — also handles 6-digit pincodes contextually
      if (!/^\d+(\.\d+)?$/.test(v)) {
        return 'Enter a valid number';
      }
      return null;
    }

    case 'text':
    case 'name':
    case 'checkbox':
      return null; // no strict validation

    default:
      return null;
  }
}

/** Dedicated pincode validator (call when fieldId includes "pin") */
export function validatePincode(value: string): string | null {
  const v = value.trim().replace(/\s/g, '');
  if (!v) return null;
  if (!/^\d{6}$/.test(v)) {
    return 'Enter a valid 6-digit pincode';
  }
  return null;
}

