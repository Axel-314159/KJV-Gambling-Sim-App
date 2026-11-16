export class ApiError extends Error {
  constructor(_status: number, _code: string, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, 
      body.code || 'UNKNOWN_ERROR', 
      body.message || res.statusText || 'Request failed (HTTP ${res.status})'
  }

  return res.status === 204 ? (undefined as T) : res.json();
}