import {
  getDesktopHostSnapshot,
  installDesktopHostBridge,
  requestDesktopHostAction,
  resetDesktopHostStateForTests
} from "@/src/lib/desktop-host";

type MessageListener = (event: { data: unknown }) => void;

function createDesktopHostWindow() {
  const listeners = new Set<MessageListener>();
  const messages: string[] = [];

  const webview = {
    addEventListener: (_type: "message", listener: MessageListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "message", listener: MessageListener) => {
      listeners.delete(listener);
    },
    postMessage: (message: string) => {
      messages.push(message);
    }
  };

  const host = {
    chrome: {
      webview
    },
    crypto: {
      randomUUID: () => "test-request-id"
    }
  };

  return {
    host,
    messages,
    dispatch(message: unknown) {
      listeners.forEach((listener) => listener({ data: message }));
    }
  };
}

describe("desktop host bridge", () => {
  beforeEach(() => {
    resetDesktopHostStateForTests();
  });

  it("switches to desktop mode after receiving host context", () => {
    const desktop = createDesktopHostWindow();

    const cleanup = installDesktopHostBridge(desktop.host);

    expect(desktop.messages).toHaveLength(1);
    expect(JSON.parse(desktop.messages[0])).toMatchObject({
      type: "miningqwq-desktop-action",
      action: "ready"
    });

    desktop.dispatch({
      type: "miningqwq-desktop-context",
      data: {
        platform: "windows-webview2",
        appVersion: "1.0.0",
        homeUrl: "https://echo.miningqwq.cn/",
        profileFolder: "C:\\Users\\test\\AppData\\Local\\MiningQwQ Music\\WebView2Profile",
        downloadUrl: "https://echo.miningqwq.cn/",
        capabilities: {
          openProfileFolder: true,
          clearWebCache: true,
          openDownloadPage: true,
          openHomeInBrowser: true
        }
      }
    });

    expect(getDesktopHostSnapshot()).toMatchObject({
      isDesktopHost: true,
      context: {
        appVersion: "1.0.0",
        platform: "windows-webview2"
      }
    });

    cleanup();
  });

  it("does not become a desktop host without explicit context", () => {
    const desktop = createDesktopHostWindow();

    const cleanup = installDesktopHostBridge(desktop.host);

    expect(getDesktopHostSnapshot().isDesktopHost).toBe(false);
    expect(getDesktopHostSnapshot().context).toBeNull();

    cleanup();
  });

  it("resolves action requests from host results", async () => {
    const desktop = createDesktopHostWindow();
    installDesktopHostBridge(desktop.host);

    desktop.dispatch({
      type: "miningqwq-desktop-context",
      data: {
        platform: "windows-webview2",
        appVersion: "1.0.0",
        homeUrl: "https://echo.miningqwq.cn/",
        profileFolder: "C:\\Users\\test\\AppData\\Local\\MiningQwQ Music\\WebView2Profile",
        downloadUrl: "https://echo.miningqwq.cn/",
        capabilities: {
          openProfileFolder: true,
          clearWebCache: true,
          openDownloadPage: true,
          openHomeInBrowser: true
        }
      }
    });

    const pending = requestDesktopHostAction("open-download-page", desktop.host);
    expect(desktop.messages).toHaveLength(2);
    const actionMessage = JSON.parse(desktop.messages[1]);
    expect(actionMessage).toMatchObject({
      type: "miningqwq-desktop-action",
      action: "open-download-page"
    });

    desktop.dispatch({
      type: "miningqwq-desktop-action-result",
      requestId: actionMessage.requestId,
      ok: true,
      message: "已打开下载页。"
    });

    await expect(pending).resolves.toMatchObject({
      requestId: actionMessage.requestId,
      ok: true,
      message: "已打开下载页。"
    });
    expect(getDesktopHostSnapshot().lastActionResult).toMatchObject({
      requestId: actionMessage.requestId,
      ok: true
    });
  });
});
