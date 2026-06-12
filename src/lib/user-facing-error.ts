"use client";

import { AccountApiError } from "@/src/lib/account-client";
import { ClientApiError } from "@/src/lib/client-api";

type ErrorWithStatus = {
  status?: number;
  code?: number;
  message?: string;
};

const FRIENDLY_MESSAGE_ALLOWLIST = new Set([
  "请输入邀请码。",
  "邀请码已复制。",
  "已离开房间。",
  "已在本地离开，服务器稍后同步。",
  "请输入昵称。",
  "请输入当前密码和新密码。",
  "新密码至少 10 位，并包含大小写字母、数字和符号。",
  "请输入关键词后再搜索。",
  "请输入邮箱和密码。",
  "请先登录后再使用一起听。",
  "请先登录后再加入一起听。",
  "请先登录后再添加好友。",
  "请先创建或加入一起听房间。",
  "请检查链接格式后重试。",
  "当前歌曲暂无可用下载链接。"
]);

function isFriendlyChineseMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (FRIENDLY_MESSAGE_ALLOWLIST.has(trimmed)) return true;
  if (/failed to fetch|networkerror|aborterror|timeout|timed out|http\s*\d+|fetch/i.test(trimmed)) {
    return false;
  }
  if (/typeerror|syntaxerror|referenceerror|prisma|sqlite|json|stack|unexpected|undefined|null/i.test(trimmed)) {
    return false;
  }
  return /[\u4e00-\u9fff]/.test(trimmed);
}

function mapStatusToMessage(status: number | undefined, fallback: string, context?: string): string {
  if (status === 401) {
    return context === "auth" ? "请先登录" : "登录状态已失效，请重新登录";
  }
  if (status === 403) {
    return context === "auth" ? "请先登录" : "当前操作暂不可用，请稍后重试";
  }
  if (status === 404) {
    return "内容不存在或已失效";
  }
  if (status === 409) {
    return "当前状态已变化，请刷新后重试";
  }
  if (status === 429) {
    return "操作过于频繁，请稍后再试";
  }
  if (typeof status === "number" && status >= 500) {
    return "服务暂时不可用，请稍后重试";
  }
  return fallback;
}

function mapKnownMessage(message: string | null | undefined, fallback: string): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (isFriendlyChineseMessage(trimmed)) return trimmed;
  if (/failed to fetch|load failed|networkerror|network request failed|fetch/i.test(trimmed)) {
    return "网络连接异常，请稍后重试";
  }
  if (/abort|timeout|timed out/i.test(trimmed)) {
    return "请求超时，请稍后重试";
  }
  if (/unauthorized|token invalid|token expired|login required|forbidden/i.test(trimmed)) {
    return "登录状态已失效，请重新登录";
  }
  if (/not found|does not exist|invalid room|expired/i.test(trimmed)) {
    return "内容不存在或已失效";
  }
  if (/conflict|already exists|state changed/i.test(trimmed)) {
    return "当前状态已变化，请刷新后重试";
  }
  if (/service unavailable|internal server error|bad gateway|gateway timeout/i.test(trimmed)) {
    return "服务暂时不可用，请稍后重试";
  }
  return fallback;
}

export function toUserFacingMessage(error: unknown, fallback: string, context?: string): string {
  if (!error) return fallback;

  if (typeof error === "string") {
    return mapKnownMessage(error, fallback) ?? fallback;
  }

  if (error instanceof AccountApiError || error instanceof ClientApiError) {
    const allowed = mapKnownMessage(error.message, fallback);
    if (allowed && allowed !== fallback) {
      return allowed;
    }
    return mapStatusToMessage(error.status, fallback, context);
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return "请求超时，请稍后重试";
  }

  if (error instanceof TypeError) {
    const mapped = mapKnownMessage(error.message, fallback);
    return mapped ?? "网络连接异常，请稍后重试";
  }

  if (error instanceof Error) {
    return mapKnownMessage(error.message, fallback) ?? fallback;
  }

  const candidate = error as ErrorWithStatus;
  if (typeof candidate?.status === "number") {
    return mapStatusToMessage(candidate.status, fallback, context);
  }
  if (typeof candidate?.message === "string") {
    return mapKnownMessage(candidate.message, fallback) ?? fallback;
  }

  return fallback;
}
