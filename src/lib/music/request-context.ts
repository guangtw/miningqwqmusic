import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { AppError } from "@/src/lib/errors";

export type MusicRequestContext = {
  signal?: AbortSignal;
  priority: number;
  owner: string;
  budget: { remaining: number };
};
const state = globalThis as typeof globalThis & { __musicContext?: AsyncLocalStorage<MusicRequestContext> };
export const musicContext = state.__musicContext ??= new AsyncLocalStorage<MusicRequestContext>();
export const requestContext = () => musicContext.getStore();

export function runMusicRequest<T>(request: Request, task: () => T): T {
  const path = new URL(request.url).pathname;
  const priority = path.endsWith("/play-url") ? 0 : /\/search(?:\/|$)|\/playlist\/|\/album\/|\/artist\//.test(path) ? 1
    : /\/lyric$|\/comments$|\/quality-options$/.test(path) ? 2 : 3;
  // An opaque scheduling key only; credentials and IPs are never logged.
  const owner = createHash("sha256").update(request.headers.get("cookie") || request.headers.get("x-forwarded-for") || "anonymous").digest("hex").slice(0, 16);
  return musicContext.run({ signal: request.signal, priority, owner, budget: { remaining: path.endsWith("/play-url") ? 5 : 8 } }, task);
}

export function spendRequestBudget() {
  const context = requestContext();
  if (context && context.budget.remaining-- <= 0) {
    throw new AppError("本次音乐请求已达到尝试上限，请重新操作。", { code: 2011, status: 503, retryable: false });
  }
}
