import { useSyncExternalStore } from "react";

export type DesktopHostAction =
  | "ready"
  | "open-profile-folder"
  | "clear-web-cache"
  | "open-download-page"
  | "open-home-in-browser"
  | "window-minimize"
  | "window-toggle-maximize"
  | "window-close"
  | "window-begin-drag"
  | "window-double-click-title";

export type DesktopHostCapabilities = {
  openProfileFolder: boolean;
  clearWebCache: boolean;
  openDownloadPage: boolean;
  openHomeInBrowser: boolean;
  windowControls: boolean;
};

export type DesktopHostContext = {
  platform: "windows-webview2";
  appVersion: string;
  homeUrl: string;
  profileFolder: string;
  downloadUrl: string;
  capabilities: DesktopHostCapabilities;
};

export type DesktopWindowState = {
  isMaximized: boolean;
  isActive: boolean;
  platformTheme?: "light" | "dark";
};

export type DesktopHostActionResult = {
  requestId: string;
  ok: boolean;
  message?: string;
};

type DesktopHostSnapshot = {
  context: DesktopHostContext | null;
  isDesktopHost: boolean;
  lastActionResult: DesktopHostActionResult | null;
  windowState: DesktopWindowState | null;
};

type DesktopHostActionMessage = {
  type: "miningqwq-desktop-action";
  action: DesktopHostAction;
  requestId: string;
  payload?: Record<string, unknown> | null;
};

type DesktopHostContextMessage = {
  type: "miningqwq-desktop-context";
  data: DesktopHostContext;
};

type DesktopHostActionResultMessage = {
  type: "miningqwq-desktop-action-result";
  requestId: string;
  ok: boolean;
  message?: string;
};

type DesktopWindowStateMessage = {
  type: "miningqwq-desktop-window-state";
  data: DesktopWindowState;
};

type DesktopHostIncomingMessage = DesktopHostContextMessage | DesktopHostActionResultMessage | DesktopWindowStateMessage;

type WebViewMessageEvent = {
  data: unknown;
};

type WindowMessageEvent = {
  data: unknown;
};

type WebViewLike = {
  addEventListener?: (type: "message", listener: (event: WebViewMessageEvent) => void) => void;
  removeEventListener?: (type: "message", listener: (event: WebViewMessageEvent) => void) => void;
  postMessage?: (message: string) => void;
};

type WindowLike = {
  chrome?: {
    webview?: WebViewLike;
  };
  crypto?: Pick<Crypto, "randomUUID">;
  addEventListener?: (type: "message", listener: (event: WindowMessageEvent) => void) => void;
  removeEventListener?: (type: "message", listener: (event: WindowMessageEvent) => void) => void;
};

type PendingDesktopAction = {
  reject: (reason?: unknown) => void;
  resolve: (value: DesktopHostActionResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const DESKTOP_HOST_ACTION_TYPE = "miningqwq-desktop-action";
const DESKTOP_HOST_CONTEXT_TYPE = "miningqwq-desktop-context";
const DESKTOP_HOST_ACTION_RESULT_TYPE = "miningqwq-desktop-action-result";
const DESKTOP_WINDOW_STATE_TYPE = "miningqwq-desktop-window-state";
const DESKTOP_HOST_ACTION_TIMEOUT_MS = 8000;

const initialSnapshot: DesktopHostSnapshot = {
  context: null,
  isDesktopHost: false,
  lastActionResult: null,
  windowState: null
};

const listeners = new Set<() => void>();
const pendingActions = new Map<string, PendingDesktopAction>();

let currentSnapshot = initialSnapshot;
let actionSequence = 0;

function emitSnapshot(nextSnapshot: DesktopHostSnapshot) {
  currentSnapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

function updateSnapshot(partial: Partial<DesktopHostSnapshot>) {
  emitSnapshot({
    ...currentSnapshot,
    ...partial
  });
}

function getWebView(targetWindow: WindowLike): WebViewLike | null {
  const webview = targetWindow.chrome?.webview;
  if (!webview || typeof webview.postMessage !== "function") {
    return null;
  }
  return webview;
}

function createRequestId(targetWindow: WindowLike): string {
  const uuid = targetWindow.crypto?.randomUUID?.();
  if (uuid) {
    return uuid;
  }
  actionSequence += 1;
  return `desktop-${Date.now()}-${actionSequence}`;
}

function isDesktopHostContext(value: unknown): value is DesktopHostContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopHostContext>;
  return candidate.platform === "windows-webview2" && typeof candidate.appVersion === "string" && typeof candidate.homeUrl === "string";
}

function parseIncomingDesktopHostMessage(raw: unknown): DesktopHostIncomingMessage | null {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        })()
      : raw;
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<DesktopHostIncomingMessage>;
  if (candidate.type === DESKTOP_HOST_CONTEXT_TYPE && isDesktopHostContext(candidate.data)) {
    return {
      type: DESKTOP_HOST_CONTEXT_TYPE,
      data: candidate.data
    };
  }

  if (
    candidate.type === DESKTOP_HOST_ACTION_RESULT_TYPE &&
    typeof candidate.requestId === "string" &&
    typeof candidate.ok === "boolean"
  ) {
    return {
      type: DESKTOP_HOST_ACTION_RESULT_TYPE,
      requestId: candidate.requestId,
      ok: candidate.ok,
      message: typeof candidate.message === "string" ? candidate.message : undefined
    };
  }

  if (
    candidate.type === DESKTOP_WINDOW_STATE_TYPE &&
    candidate.data &&
    typeof candidate.data === "object" &&
    typeof (candidate.data as Partial<DesktopWindowState>).isMaximized === "boolean" &&
    typeof (candidate.data as Partial<DesktopWindowState>).isActive === "boolean"
  ) {
    const windowState = candidate.data as DesktopWindowState;
    return {
      type: DESKTOP_WINDOW_STATE_TYPE,
      data: {
        isMaximized: windowState.isMaximized,
        isActive: windowState.isActive,
        platformTheme: windowState.platformTheme === "light" || windowState.platformTheme === "dark" ? windowState.platformTheme : undefined
      }
    };
  }

  return null;
}

function resolvePendingDesktopAction(result: DesktopHostActionResult) {
  const pending = pendingActions.get(result.requestId);
  if (!pending) return;
  pendingActions.delete(result.requestId);
  clearTimeout(pending.timeoutId);
  pending.resolve(result);
}

function handleDesktopHostMessage(raw: unknown) {
  const message = parseIncomingDesktopHostMessage(raw);
  if (!message) return;

  if (message.type === DESKTOP_HOST_CONTEXT_TYPE) {
    updateSnapshot({
      context: message.data,
      isDesktopHost: true
    });
    return;
  }

  if (message.type === DESKTOP_WINDOW_STATE_TYPE) {
    updateSnapshot({
      windowState: message.data,
      isDesktopHost: true
    });
    return;
  }

  const result: DesktopHostActionResult = {
    requestId: message.requestId,
    ok: message.ok,
    message: message.message
  };
  updateSnapshot({
    lastActionResult: result
  });
  resolvePendingDesktopAction(result);
}

function postDesktopHostAction(
  action: DesktopHostAction,
  requestId: string,
  targetWindow: WindowLike,
  payload?: Record<string, unknown> | null
) {
  const webview = getWebView(targetWindow);
  if (!webview) {
    throw new Error("桌面客户端通信不可用。");
  }

  const message: DesktopHostActionMessage = {
    type: DESKTOP_HOST_ACTION_TYPE,
    action,
    requestId,
    payload: payload ?? null
  };
  webview.postMessage?.(JSON.stringify(message));
}

export function installDesktopHostBridge(targetWindow: WindowLike = window): () => void {
  const webview = getWebView(targetWindow);
  const handleMessage = (event: WebViewMessageEvent | WindowMessageEvent) => {
    handleDesktopHostMessage(event.data);
  };

  if (webview && typeof webview.addEventListener === "function") {
    webview.addEventListener("message", handleMessage);
    try {
      postDesktopHostAction("ready", createRequestId(targetWindow), targetWindow);
    } catch {
      // Ignore: if the bridge isn't ready yet, navigation completed will trigger another handshake.
    }
  }

  targetWindow.addEventListener?.("message", handleMessage);

  return () => {
    webview?.removeEventListener?.("message", handleMessage);
    targetWindow.removeEventListener?.("message", handleMessage);
  };
}

export function requestDesktopHostAction(
  action: Exclude<DesktopHostAction, "ready">,
  targetWindow: WindowLike = window,
  payload?: Record<string, unknown> | null
): Promise<DesktopHostActionResult> {
  if (!currentSnapshot.isDesktopHost || !currentSnapshot.context) {
    return Promise.reject(new Error("桌面客户端暂未连接，请稍后重试。"));
  }

  const requestId = createRequestId(targetWindow);

  return new Promise<DesktopHostActionResult>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingActions.delete(requestId);
      reject(new Error("桌面客户端响应超时，请稍后重试。"));
    }, DESKTOP_HOST_ACTION_TIMEOUT_MS);

    pendingActions.set(requestId, {
      resolve,
      reject,
      timeoutId
    });

    try {
      postDesktopHostAction(action, requestId, targetWindow, payload);
    } catch (error) {
      pendingActions.delete(requestId);
      clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error("桌面动作发送失败。"));
    }
  });
}

export function subscribeDesktopHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDesktopHostSnapshot(): DesktopHostSnapshot {
  return currentSnapshot;
}

export function useDesktopHost(): DesktopHostSnapshot {
  return useSyncExternalStore(subscribeDesktopHost, getDesktopHostSnapshot, getDesktopHostSnapshot);
}

export function resetDesktopHostStateForTests() {
  pendingActions.forEach((pending) => {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error("桌面桥接已重置。"));
  });
  pendingActions.clear();
  actionSequence = 0;
  emitSnapshot(initialSnapshot);
}
