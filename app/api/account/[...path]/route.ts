import { NextRequest } from "next/server";
import { failure } from "@/src/lib/api-response";
import { createTraceId } from "@/src/lib/trace";
import { accountServiceUrl } from "@/src/lib/account-service";
import { isIP } from "node:net";

const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "cookie",
  "user-agent",
  "accept",
  "accept-language",
  "last-event-id"
] as const;

const RESPONSE_HEADERS_PASSTHROUGH = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "x-accel-buffering",
  "retry-after"
] as const;

function buildTargetUrl(request: NextRequest, pathSegments: string[]): URL {
  const target = accountServiceUrl(pathSegments);
  target.search = request.nextUrl.search;
  return target;
}

function pickForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const key of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  // Enabled only for the deployment where Nginx overwrites X-Real-IP and both
  // application ports listen on loopback. Never forward a client-supplied XFF chain.
  if (process.env.ACCOUNT_TRUST_PROXY_HEADERS === "1") {
    const ip = request.headers.get("x-real-ip")?.trim();
    if (ip && isIP(ip)) {
      headers.set("x-real-ip", ip);
      headers.set("x-forwarded-for", ip);
    }
  }
  return headers;
}

async function proxyAccountRequest(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const traceId = createTraceId();
  let targetUrl: URL;
  try {
    targetUrl = buildTargetUrl(request, pathSegments);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_SERVICE_PATH_INVALID") {
      return failure({ code: 4001, message: "Invalid account path", traceId, status: 400 });
    }
    if (error instanceof Error && error.message === "ACCOUNT_SERVICE_NOT_CONFIGURED") {
      return failure({
        code: 5401,
        message: "Account service is not configured",
        traceId,
        status: 503,
        retryable: false
      });
    }
    return failure({
      code: 5402,
      message: "Account service target is invalid",
      traceId,
      status: 500,
      retryable: false
    });
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  if (request.signal.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(), 15000);
  let streaming = false;
  const cleanup = () => request.signal.removeEventListener("abort", onAbort);
  try {
    const bodyBuffer = hasBody ? await request.arrayBuffer() : undefined;
    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers: pickForwardHeaders(request),
      body: hasBody ? bodyBuffer : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
    // The deadline covers response headers; SSE streams stay connected.
    clearTimeout(timer);

    const headers = new Headers();
    for (const headerName of RESPONSE_HEADERS_PASSTHROUGH) {
      const value = upstreamResponse.headers.get(headerName);
      if (value) {
        headers.set(headerName, value);
      }
    }

    const setCookieGetter = (upstreamResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof setCookieGetter === "function") {
      const cookies = setCookieGetter.call(upstreamResponse.headers);
      for (const cookie of cookies) {
        headers.append("set-cookie", cookie);
      }
    } else {
      const cookieHeader = upstreamResponse.headers.get("set-cookie");
      if (cookieHeader) {
        headers.set("set-cookie", cookieHeader);
      }
    }

    headers.set("cache-control", "no-store");
    let body = upstreamResponse.body;
    if (body && upstreamResponse.headers.get("content-type")?.includes("text/event-stream")) {
      streaming = true;
      const reader = body.getReader();
      body = new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(output) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { cleanup(); output.close(); }
            else output.enqueue(chunk.value);
          } catch (error) { cleanup(); output.error(error); }
        },
        async cancel(reason) {
          controller.abort();
          cleanup();
          await reader.cancel(reason).catch(() => undefined);
        }
      });
    }
    return new Response(body, {
      status: upstreamResponse.status,
      headers
    });
  } catch {
    return failure({
      code: 5403,
      message: "Account service unavailable",
      traceId,
      status: controller.signal.aborted ? 504 : 502,
      retryable: true
    });
  } finally {
    clearTimeout(timer);
    if (!streaming) cleanup();
  }
}

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const params = await context.params;
  const path = params.path ?? [];
  return proxyAccountRequest(request, path);
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}
