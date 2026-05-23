import { NextResponse } from "next/server";
import type { ApiFailure, ApiSuccess } from "@/src/types/music";

export function success<T>(data: T, traceId: string, message = "ok", status = 200) {
  const payload: ApiSuccess<T> = {
    code: 0,
    data,
    message,
    traceId
  };
  return NextResponse.json(payload, { status });
}

export function failure(error: {
  code: number;
  message: string;
  traceId: string;
  retryable?: boolean;
  status?: number;
}) {
  const payload: ApiFailure = {
    code: error.code,
    message: error.message,
    traceId: error.traceId,
    retryable: error.retryable ?? false
  };
  return NextResponse.json(payload, { status: error.status ?? 500 });
}
