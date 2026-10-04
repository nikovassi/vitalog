import { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { ApiError, post } from '../../lib/api';
import { useMediaQuery } from '../../lib/hooks';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';

/** Get a short-lived signed URL (5 min, bound to this user) – never a public link. */
export async function signedUrl(documentId: string, disposition: 'inline' | 'attachment') {
  const r = await post<{ url: string }>(`/api/documents/${documentId}/url`, { disposition });
  return r.url;
}

export async function downloadDocument(documentId: string) {
  const url = await signedUrl(documentId, 'attachment');
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The original PDF – secondary to the structured data, but always one tap away. */
export function PdfViewer({ documentId, name, open, onClose, page }: { documentId: string; name: string; open: boolean; onClose: () => void; page?: number | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mobile = useMediaQuery('(max-width: 768px)');
  useEffect(() => {
    if (!open) { setUrl(null); return; }
    setError(null);
    signedUrl(documentId, 'inline').then(setUrl).catch((e: ApiError) => setError(e.message));
  }, [open, documentId]);
  return (
    <Dialog open={open} onClose={onClose} title={name} size="lg"
      footer={<>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-[15px] font-medium hover:bg-surface-2"><ExternalLink className="size-4" />Отвори в нов раздел</a>}
        <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadDocument(documentId)}>Изтегли</Button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}
      {!url && !error && <div className="flex h-64 items-center justify-center text-muted"><Loader2 className="size-6 animate-spin" aria-label="Зареждане" /></div>}
      {url && (mobile
        ? <p className="text-[15px] text-ink-2">На телефона PDF файлът се отваря в отделен раздел. Използвай „Отвори в нов раздел“.</p>
        : <iframe title={name} src={`${url}${page ? `#page=${page}` : ''}`} className="h-[70dvh] w-full rounded-xl border border-border bg-white" />)}
    </Dialog>
  );
}
