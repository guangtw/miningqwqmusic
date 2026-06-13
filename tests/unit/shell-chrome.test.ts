import { collectShellChromeTokens, installShellChromeBridge, postShellChromeTokens } from "@/src/lib/shell-chrome";

function createMatchMediaStub() {
  return () =>
    ({
      matches: false,
      media: "(prefers-color-scheme: light)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }) as unknown as MediaQueryList;
}

describe("shell chrome bridge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-shell-mode");
    document.documentElement.style.cssText = "";
  });

  it("collects structured shell chrome tokens from css variables", () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.setProperty("--shell-surface-background", "#eef3f8");
    document.documentElement.style.setProperty("--shell-header-background", "rgba(246, 250, 255, 0.96)");
    document.documentElement.style.setProperty("--shell-header-border", "rgba(28, 40, 56, 0.14)");
    document.documentElement.style.setProperty("--shell-window-border", "rgba(28, 40, 56, 0.24)");
    document.documentElement.style.setProperty("--shell-title-foreground", "#101623");
    document.documentElement.style.setProperty("--shell-subtitle-foreground", "#4f5d73");
    document.documentElement.style.setProperty("--shell-caption-foreground", "#101623");
    document.documentElement.style.setProperty("--shell-caption-hover-background", "rgba(16, 24, 40, 0.08)");
    document.documentElement.style.setProperty("--shell-caption-pressed-background", "rgba(16, 24, 40, 0.14)");
    document.documentElement.style.setProperty("--shell-close-hover-background", "rgba(196, 52, 74, 0.86)");
    document.documentElement.style.setProperty("--shell-close-pressed-background", "rgba(169, 39, 60, 0.94)");
    document.documentElement.style.setProperty("--shell-radius-large", "18px");

    const tokens = collectShellChromeTokens(document);

    expect(tokens.mode).toBe("light");
    expect(tokens.surfaceBackground).toBe("#FFEEF3F8");
    expect(tokens.headerBackground).toBe("#F5F6FAFF");
    expect(tokens.windowBorder).toBe("#3D1C2838");
    expect(tokens.captionPressedBackground).toBe("#24101828");
    expect(tokens.radiusLarge).toBe(18);
  });

  it("prefers shell mode override for desktop chrome tokens", () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.shellMode = "dark";

    const tokens = collectShellChromeTokens(document);

    expect(tokens.mode).toBe("dark");
    expect(tokens.surfaceBackground).toBe("#FF07090D");
  });

  it("returns to the active document theme when shell mode override is cleared", () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.shellMode = "dark";

    expect(collectShellChromeTokens(document).mode).toBe("dark");

    delete document.documentElement.dataset.shellMode;

    const tokens = collectShellChromeTokens(document);
    expect(tokens.mode).toBe("light");
    expect(tokens.surfaceBackground).toBe("#FFEEF3F8");
  });

  it("posts shell chrome payloads to WebView hosts", () => {
    document.documentElement.dataset.theme = "dark";
    const postMessage = vi.fn();
    const host = { chrome: { webview: { postMessage } } } as unknown as Window;

    const posted = postShellChromeTokens(host, document);

    expect(posted).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toContain("miningqwq-shell-chrome:");
    expect(postMessage.mock.calls[0][0]).toContain("\"mode\":\"dark\"");
  });

  it("posts the updated payload immediately after theme changes", () => {
    document.documentElement.dataset.theme = "dark";
    const postMessage = vi.fn();
    const host = { chrome: { webview: { postMessage } } } as unknown as Window;

    postShellChromeTokens(host, document);
    document.documentElement.dataset.theme = "light";
    postShellChromeTokens(host, document);

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][0]).toContain("\"mode\":\"dark\"");
    expect(postMessage.mock.calls[1][0]).toContain("\"mode\":\"light\"");
  });

  it("reposts when the document theme changes", async () => {
    document.documentElement.dataset.theme = "dark";
    const postMessage = vi.fn();
    const host = {
      chrome: { webview: { postMessage } },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
      matchMedia: createMatchMediaStub()
    } as unknown as Window;

    const cleanup = installShellChromeBridge(host, document);
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.documentElement.dataset.theme = "light";
    await new Promise((resolve) => setTimeout(resolve, 0));

    cleanup();

    const lastCall = postMessage.mock.calls[postMessage.mock.calls.length - 1][0];
    expect(postMessage).toHaveBeenCalled();
    expect(postMessage.mock.calls[0][0]).toContain("\"mode\":\"dark\"");
    expect(lastCall).toContain("\"mode\":\"light\"");
  });
});
