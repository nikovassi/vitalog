import { useEffect, useState } from 'react';
import type { Specialist } from '@vitalog/shared';
import { initials } from '../../lib/util';

/** Specialist photo (fetched with the session cookie, never a public URL) or initials. */
export function Avatar({ s, size = 'size-12' }: { s: Pick<Specialist, 'id' | 'name' | 'hasPhoto'>; size?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!s.hasPhoto) return;
    let u: string | null = null;
    fetch(`/api/specialists/${s.id}/photo`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => {});
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [s.id, s.hasPhoto]);
  return url
    ? <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    : <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-display font-semibold text-accent-soft-ink`} aria-hidden>{initials(s.name)}</span>;
}
