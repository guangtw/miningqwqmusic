import { api } from '../config/site';
import type { ApiFailure, ApiSuccess } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly status: number,
    readonly traceId?: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** 把 '/api/music/track/:id' 这类路径模板填上参数 */
export function path(template: string, params: Record<string, string> = {}): string {
  return template.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
}

type Query = Record<string, string | number | undefined>;

export interface RequestInitEx {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

const hasCjk = (s: string) => /[一-鿿]/.test(s);

/** 优先用配置里的中文说明；后端本来就是中文的照原样显示 */
function friendlyMessage(code: number, message?: string): string {
  return api.errorText[code] ?? (message && hasCjk(message) ? message : api.errorFallback);
}

function isFailure(p: unknown): p is ApiFailure {
  return !!p && typeof p === 'object' && 'code' in p && 'message' in p;
}

/** 调 BFF：成功返回 data，失败抛 ApiError（带后端的 code / traceId） */
export async function request<T>(urlPath: string, init: RequestInitEx = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
  const url = `${api.base}${urlPath}${qs.size ? `?${qs}` : ''}`;

  const headers = new Headers();
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init.body !== undefined) headers.set('content-type', 'application/json');

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: api.base ? 'include' : 'same-origin',
      cache: 'no-store',
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('连不上服务，检查一下网络。', 5000, 0, undefined, true);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError(`请求失败（HTTP ${res.status}）`, 5000, res.status);
  }

  if (res.ok && payload && typeof payload === 'object' && (payload as ApiSuccess<T>).code === 0) {
    return (payload as ApiSuccess<T>).data;
  }
  if (isFailure(payload)) {
    throw new ApiError(friendlyMessage(payload.code, payload.message), payload.code, res.status, payload.traceId, payload.retryable);
  }
  throw new ApiError(`请求失败（HTTP ${res.status}）`, 5000, res.status);
}
