export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

import { GetAPIToken } from '../../wailsjs/go/wails/Bindings';

export async function getRawToken(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    try {
      const token = await GetAPIToken();
      if (token) return token;
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return '';
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getRawToken();
  if (token) {
    return { 'Authorization': `Bearer ${token}` };
  }
  return {};
}

export async function fetcher<T>(url: string, init?: RequestInit): Promise<T> {
  const auth = await getAuthHeader();
  
  // Merge headers from init and our auth token
  const headers: Record<string, string> = {};
  if (init?.headers) {
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
  }
  Object.assign(headers, auth);

  const res = await fetch(url, {
    ...init, 
    headers 
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || 'Request failed');
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json();
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  return fetcher<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patch<T>(url: string, body: unknown): Promise<T> {
  return fetcher<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
