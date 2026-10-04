/**
 * API client. Session = HttpOnly cookie (never readable by JS). The CSRF token comes from
 * /api/auth/me and is sent on every state-changing request.
 */
let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => { csrfToken = t; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (fn: Listener) => {
  unauthorizedListeners.add(fn);
  return () => { unauthorizedListeners.delete(fn); };
};

async function parse(res: Response) {
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const b = (typeof body === 'object' ? body : {}) as { code?: string; message?: string };
    if (res.status === 401 && b.code !== 'invalid_credentials' && b.code !== 'invalid_code') unauthorizedListeners.forEach((l) => l());
    throw new ApiError(res.status, b.code ?? 'error', b.message ?? 'Възникна грешка. Опитай отново.', body as Record<string, unknown>);
  }
  return body;
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Няма връзка със сървъра. Провери интернет връзката.');
  }
  return parse(res) as Promise<T>;
}

export const get = <T,>(url: string) => api<T>('GET', url);
export const post = <T,>(url: string, body?: unknown) => api<T>('POST', url, body ?? {});
export const patch = <T,>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const put = <T,>(url: string, body?: unknown) => api<T>('PUT', url, body ?? {});
export const del = <T,>(url: string) => api<T>('DELETE', url);

/** Multipart upload with REAL upload progress (XHR exposes bytes sent; fetch does not). */
export function upload<T>(url: string, form: FormData, onProgress: (pct: number) => void, method = 'POST'): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader('x-csrf-token', csrfToken);
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Връзката прекъсна по време на качването. Опитай отново.'));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        if (xhr.status === 401) unauthorizedListeners.forEach((l) => l());
        reject(new ApiError(xhr.status, String(body.code ?? 'error'), String(body.message ?? 'Качването не успя.'), body));
      }
    };
    xhr.send(form);
  });
}

/** Download a file returned by a POST/GET (blob) without exposing a public URL. */
export async function downloadBlob(method: 'GET' | 'POST', url: string, filename: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }).catch(() => {
    throw new ApiError(0, 'network', 'Няма връзка със сървъра.');
  });
  if (!res.ok) await parse(res);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
