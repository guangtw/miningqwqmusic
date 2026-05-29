import { NextRequest } from "next/server";
import { failure } from "@/src/lib/api-response";
import { createTraceId } from "@/src/lib/trace";

const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "cookie",
  "user-agent",
  "accept",
  "accept-language",
  "x-forwarded-for",
  "x-forwarded-proto"
] as const;

const RESPONSE_HEADERS_PASSTHROUGH = ["content-type", "cache-control", "etag", "last-modified"] as const;

function resolveServiceBaseUrl(): string | null {
  const raw = process.env.ACCOUNT_SERVICE_BASE_URL;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

function buildTargetUrl(request: NextRequest, pathSegments: string[]): URL {
  const base = resolveServiceBaseUrl();
  if (!base) {
    throw new Error("ACCOUNT_SERVICE_NOT_CONFIGURED");
  }
  const joinedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  const target = new URL(`${base}/api/account/${joinedPath}`);
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
  return headers;
}

async function proxyAccountRequest(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const traceId = createTraceId();
  let targetUrl: URL;
  try {
    targetUrl = buildTargetUrl(request, pathSegments);
  } catch (error) {
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
  const bodyBuffer = hasBody ? await request.arrayBuffer() : undefined;

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers: pickForwardHeaders(request),
      body: hasBody ? bodyBuffer : undefined,
      redirect: "manual",
      cache: "no-store"
    });

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

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers
    });
  } catch {
    return failure({
      code: 5403,
      message: "Account service unavailable",
      traceId,
      status: 502,
      retryable: true
    });
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