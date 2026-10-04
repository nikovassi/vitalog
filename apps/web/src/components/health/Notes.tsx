import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { formatDateTime, type Note, type NoteTarget } from '@vitalog/shared';
import { del, post } from '../../lib/api';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Form';

/** Personal notes for context. The platform never draws conclusions from them. */
export function Notes({ notes, targetType, targetId, invalidate }: { notes: Note[]; targetType: NoteTarget; targetId: string; invalidate: unknown[] }) {
  const [body, setBody] = useState('');
  const qc = useQueryClient();
  const add = useMutation({ mutationFn: () => post('/api/notes', { targetType, targetId, body }), onSuccess: () => { setBody(''); void qc.invalidateQueries({ queryKey: invalidate }); } });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/notes/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: invalidate }) });
  return (
    <div>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <Textarea label="Нова бележка" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Напр. „Започнах нов режим на хранене.“" className="min-h-11 sm:min-h-11" rows={1} />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!body.trim()}>Добави</Button>
      </form>
      {notes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-[15px]">{n.body}</p>
                <p className="num text-xs text-muted">{formatDateTime(n.createdAt)}</p>
              </div>
              <button onClick={() => remove.mutate(n.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-ink" aria-label="Изтрий бележката"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
