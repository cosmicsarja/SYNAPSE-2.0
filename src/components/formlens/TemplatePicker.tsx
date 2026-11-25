/**
 * Template picker — loads JSON templates from /public/templates/.
 */
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FileText } from 'lucide-react';

export interface TemplateField {
  id: string;
  labelEn: string;
  labelKn: string;
  type: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface FormTemplate {
  id: string;
  name: string;
  nameKannada: string;
  version: string;
  fields: TemplateField[];
}

const TEMPLATE_URLS = [
  '/templates/ration-card.json',
  '/templates/income-certificate.json',
];

interface Props {
  onSelect: (template: FormTemplate) => void;
  selected?: string;
}

export function TemplatePicker({ onSelect, selected }: Props) {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all(
      TEMPLATE_URLS.map((url) =>
        fetch(url)
          .then((r) => r.json() as Promise<FormTemplate>)
          .catch(() => null),
      ),
    ).then((results) => {
      setTemplates(results.filter((t): t is FormTemplate => t !== null));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading templates…</div>;
  }

  return (
    <div className="grid gap-3">
      {templates.map((tpl) => (
        <Card
          key={tpl.id}
          className={`cursor-pointer transition-all ${selected === tpl.id ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-border'}`}
          onClick={() => onSelect(tpl)}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-8 w-8 shrink-0 text-primary" />
            <div>
              <div className="font-semibold text-sm">{tpl.name}</div>
              <div className="text-xs text-muted-foreground">{tpl.nameKannada}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{tpl.fields.length} fields</div>
            </div>
            {selected === tpl.id && (
              <div className="ml-auto text-primary text-xs font-semibold">✓ Selected</div>
            )}
          </CardContent>
        </Card>
      ))}
      {templates.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4">
          No templates found. Place JSON templates in /public/templates/.
        </div>
      )}
    </div>
  );
}

export { Button };

