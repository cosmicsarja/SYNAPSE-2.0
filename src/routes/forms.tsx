/**
 * Saved Forms list route.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { ConfidenceBadge } from '@/components/formlens/ConfidenceBadge';
import { db, deleteForm } from '@/db';
import type { SavedForm } from '@/db/schema';
import { exportJson, exportCsv, exportPdf } from '@/lib/formlens/exports';
import { Search, Trash2, Download, PenLine, Camera } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const Route = createFileRoute('/forms')({
  head: () => ({ meta: [{ title: 'Saved Forms – FormLens' }] }),
  component: FormsPage,
});

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  reviewed: 'bg-blue-100 text-blue-800',
  synced: 'bg-green-100 text-green-800',
};

function FormsPage() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<SavedForm[]>([]);
  const [search, setSearch] = useState('');
  const [syncCount, setSyncCount] = useState(0);

  const loadForms = () => {
    db.forms.orderBy('createdAt').reverse().toArray().then(setForms);
    db.syncQueue.count().then(setSyncCount);
  };

  useEffect(() => {
    loadForms();
  }, []);

  const handleDelete = async (id: number) => {
    await deleteForm(id);
    loadForms();
  };

  const getFields = async (formId: number) => {
    return db.formFields.where('formId').equals(formId).toArray();
  };

  const filtered = forms.filter((f) =>
    f.templateName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      <OfflineStatusBar />

      {/* Header */}
      <div className="border-b px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-lg">Saved Forms</h1>
          {syncCount > 0 && (
            <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
              {syncCount} waiting to sync
            </Badge>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search forms…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-24">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
            <Camera className="h-14 w-14 text-muted-foreground/40" />
            <div className="text-muted-foreground text-sm">
              {search ? 'No forms match your search.' : 'No forms saved yet. Scan a form to get started.'}
            </div>
            {!search && (
              <Button onClick={() => void navigate({ to: '/scan' })}>
                Scan a Form
              </Button>
            )}
          </div>
        )}

        {filtered.map((form) => (
          <Card key={form.id} className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex gap-3">
                {/* Thumbnail */}
                <div className="w-20 h-24 bg-muted shrink-0 overflow-hidden">
                  {form.thumbnailDataUrl
                    ? <img src={form.thumbnailDataUrl} alt="Form thumbnail" className="h-full w-full object-cover" />
                    : <div className="h-full w-full flex items-center justify-center text-muted-foreground/40">
                        <PenLine className="h-6 w-6" />
                      </div>
                  }
                </div>

                {/* Info */}
                <div className="flex-1 py-3 pr-3 min-w-0">
                  <div className="font-semibold text-sm truncate">{form.templateName}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(form.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_COLORS[form.status] ?? ''}`}>
                      {form.status}
                    </span>
                    <ConfidenceBadge confidence={form.avgConfidence} />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-2"
                      onClick={() => void navigate({ to: '/review/$id', params: { id: String(form.id) } })}
                    >
                      Reopen
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2">
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={async () => {
                          const fields = await getFields(form.id!);
                          exportJson(form, fields);
                        }}>JSON</DropdownMenuItem>
                        <DropdownMenuItem onClick={async () => {
                          const fields = await getFields(form.id!);
                          exportCsv(form, fields);
                        }}>CSV</DropdownMenuItem>
                        <DropdownMenuItem onClick={async () => {
                          const fields = await getFields(form.id!);
                          exportPdf(form, fields);
                        }}>PDF</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete form?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete "{form.templateName}" from {new Date(form.createdAt).toLocaleDateString()}. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void handleDelete(form.id!)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <BottomNav />
    </div>
  );
}
