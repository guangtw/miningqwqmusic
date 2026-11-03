import { api } from '../config/site';
import type { ApiFailure, ApiSuccess } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly status: number,
    readonly traceId?: string,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

const hasCjk = (s: string) => /[一-鿿]/.test(s);

/** 优先用配置里的中文说明；后端本来就是中文的照原样显示 */
export function waitLabel(seconds: number): string {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟` : `${Math.ceil(seconds)} 秒`;
}

export function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function friendlyMessage(code: number, message?: string, status = 0, retryAfter?: number, auth = false): string {
  const wait = retryAfter ? `请在 ${waitLabel(retryAfter)}后再试。` : '请稍后再试。';
  if (code === 5206 && status === 403) return '当前账号没有操作权限。';
  if (code === 5206 && status === 429) return `密码连续输错，登录已暂时保护。${wait}`;
  if (code === 5205 || (auth && status === 429)) return `尝试太频繁了，${wait}`;
  if (auth && (status >= 500 || code === 5402 || code === 5403)) return '账户服务暂时连不上，请稍后再试。';
  if (auth && code === 5207) return '登录请求未通过安全校验，请刷新页面后再试。';
  return api.errorText[code] ?? (message && hasCjk(message) ? message : api.errorFallback);
}

function isFailure(p: unknown): p is ApiFailure {
  return !!p && typeof p === 'object' && 'code' in p && 'message' in p;
}

/** 调 BFF：成功返回 data，失败抛 ApiError（带后端的 code / traceId） */
export async function request<T>(urlPath: string, init: RequestInitEx = {}): Promise<T> {
  const auth = urlPath.startsWith('/api/account/auth/');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
  const url = `${api.base}${urlPath}${qs.size ? `?${qs}` : ''}`;

  const headers = new Headers();
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  // FormData（上传头像）让浏览器自己带 multipart 边界
  const form = init.body instanceof FormData;
  if (init.body !== undefined && !form) headers.set('content-type', 'application/json');

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : form ? (init.body as FormData) : JSON.stringify(init.body),
      credentials: api.base ? 'include' : 'same-origin',
      cache: 'no-store',
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(auth ? '连不上账户服务，检查一下网络后再试。' : '连不上服务，检查一下网络。', 5000, 0, undefined, true);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    init.signal?.throwIfAborted();
    const retry = retryAfterSeconds(res.headers.get('retry-after'));
    throw new ApiError(friendlyMessage(5000, `请求失败（HTTP ${res.status}）`, res.status, retry, auth), 5000, res.status, undefined, res.status === 429 || res.status >= 500, retry);
  }

  if (res.ok && payload && typeof payload === 'object' && (payload as ApiSuccess<T>).code === 0) {
    return (payload as ApiSuccess<T>).data;
  }
  if (isFailure(payload)) {
    const retry = typeof payload.retryAfterSeconds === 'number' && Number.isFinite(payload.retryAfterSeconds) && payload.retryAfterSeconds > 0
      ? Math.ceil(payload.retryAfterSeconds) : retryAfterSeconds(res.headers.get('retry-after'));
    throw new ApiError(friendlyMessage(payload.code, payload.message, res.status, retry, auth), payload.code, res.status, payload.traceId, payload.retryable, retry);
  }
  const retry = retryAfterSeconds(res.headers.get('retry-after'));
  throw new ApiError(friendlyMessage(5000, `请求失败（HTTP ${res.status}）`, res.status, retry, auth), 5000, res.status, undefined, res.status === 429 || res.status >= 500, retry);
}
