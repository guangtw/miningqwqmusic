export type ShellChromeMode = "dark" | "light";

export type ShellChromeTokens = {
  mode: ShellChromeMode;
  surfaceBackground: string;
  headerBackground: string;
  headerBorder: string;
  windowBorder: string;
  titleForeground: string;
  subtitleForeground: string;
  captionForeground: string;
  captionHoverBackground: string;
  captionPressedBackground: string;
  closeHoverBackground: string;
  closePressedBackground: string;
  radiusLarge: number;
};

type WebViewHost = {
  chrome?: {
    webview?: {
      postMessage: (message: string) => void;
    };
  };
};

type WindowLike = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame" | "matchMedia"> & WebViewHost;
type ObservedDocument = Pick<Document, "body" | "createElement" | "documentElement">;

const SHELL_CHROME_MESSAGE_PREFIX = "miningqwq-shell-chrome:";

function readCssToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

function normalizeCssColor(doc: ObservedDocument, value: string): string {
  const probe = doc.createElement("span");
  probe.style.position = "fixed";
  probe.style.pointerEvents = "none";
  probe.style.opacity = "0";
  probe.style.inset = "-9999px auto auto -9999px";
  probe.style.color = value;
  (doc.body ?? doc.documentElement).appendChild(probe);
  const normalized = getComputedStyle(probe).color;
  probe.remove();

  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i.exec(normalized);
  if (!match) {
    return value;
  }

  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  const alphaByte = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  const parts = [alphaByte, red, green, blue].map((part) => part.toString(16).padStart(2, "0").toUpperCase());
  return `#${parts.join("")}`;
}

function parseRadius(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(parsed, 48));
}

export function collectShellChromeTokens(doc: Document = document): ShellChromeTokens {
  const root = doc.documentElement;
  const styles = getComputedStyle(root);
  const mode = root.dataset.theme === "light" ? "light" : "dark";

  return {
    mode,
    surfaceBackground: normalizeCssColor(doc, readCssToken(styles, "--shell-surface-background", mode === "light" ? "#eef3f8" : "#07090d")),
    headerBackground: normalizeCssColor(doc, readCssToken(styles, "--shell-header-background", mode === "light" ? "rgba(246, 250, 255, 0.96)" : "rgba(7, 9, 13, 0.97)")),
    headerBorder: normalizeCssColor(doc, readCssToken(styles, "--shell-header-border", mode === "light" ? "rgba(28, 40, 56, 0.14)" : "rgba(255, 255, 255, 0.09)")),
    windowBorder: normalizeCssColor(doc, readCssToken(styles, "--shell-window-border", mode === "light" ? "rgba(28, 40, 56, 0.24)" : "rgba(255, 255, 255, 0.16)")),
    titleForeground: normalizeCssColor(doc, readCssToken(styles, "--shell-title-foreground", mode === "light" ? "#101623" : "#f7f8fb")),
    subtitleForeground: normalizeCssColor(doc, readCssToken(styles, "--shell-subtitle-foreground", mode === "light" ? "#4f5d73" : "#b8c0cf")),
    captionForeground: normalizeCssColor(doc, readCssToken(styles, "--shell-caption-foreground", mode === "light" ? "#101623" : "#f7f8fb")),
    captionHoverBackground: normalizeCssColor(doc, readCssToken(styles, "--shell-caption-hover-background", mode === "light" ? "rgba(16, 24, 40, 0.08)" : "rgba(255, 255, 255, 0.12)")),
    captionPressedBackground: normalizeCssColor(doc, readCssToken(styles, "--shell-caption-pressed-background", mode === "light" ? "rgba(16, 24, 40, 0.14)" : "rgba(255, 255, 255, 0.18)")),
    closeHoverBackground: normalizeCssColor(doc, readCssToken(styles, "--shell-close-hover-background", mode === "light" ? "rgba(196, 52, 74, 0.86)" : "rgba(63, 63, 70, 0.85)")),
    closePressedBackground: normalizeCssColor(doc, readCssToken(styles, "--shell-close-pressed-background", mode === "light" ? "rgba(169, 39, 60, 0.94)" : "rgba(50, 50, 56, 0.94)")),
    radiusLarge: parseRadius(readCssToken(styles, "--shell-radius-large", readCssToken(styles, "--radius-xl", "18")), 18)
  };
}

export function postShellChromeTokens(targetWindow: WindowLike = window, doc: Document = document): boolean {
  const postMessage = targetWindow.chrome?.webview?.postMessage;
  if (typeof postMessage !== "function") {
    return false;
  }

  postMessage(`${SHELL_CHROME_MESSAGE_PREFIX}${JSON.stringify(collectShellChromeTokens(doc))}`);
  return true;
}

export function installShellChromeBridge(targetWindow: WindowLike = window, doc: Document = document): () => void {
  let frameId = 0;
  let scheduled = false;
  let lastPayload = "";

  const flush = () => {
    scheduled = false;
    frameId = 0;
    const payload = JSON.stringify(collectShellChromeTokens(doc));
    if (payload === lastPayload) {
      return;
    }

    lastPayload = payload;
    targetWindow.chrome?.webview?.postMessage?.(`${SHELL_CHROME_MESSAGE_PREFIX}${payload}`);
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frameId = targetWindow.requestAnimationFrame(flush);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style", "class"]
  });

  if (doc.body) {
    observer.observe(doc.body, {
      attributes: true,
      attributeFilter: ["style", "class"]
    });
  }

  const mediaQuery = targetWindow.matchMedia("(prefers-color-scheme: light)");
  const handleMediaChange = () => schedule();
  mediaQuery.addEventListener?.("change", handleMediaChange);

  schedule();

  return () => {
    observer.disconnect();
    mediaQuery.removeEventListener?.("change", handleMediaChange);
    if (frameId !== 0) {
      targetWindow.cancelAnimationFrame(frameId);
      frameId = 0;
    }
    scheduled = false;
  };
}
