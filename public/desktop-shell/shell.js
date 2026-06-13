(function () {
  const DESKTOP_ACTION_TYPE = "miningqwq-desktop-action";
  const DESKTOP_CONTEXT_TYPE = "miningqwq-desktop-context";
  const DESKTOP_WINDOW_STATE_TYPE = "miningqwq-desktop-window-state";
  const SHELL_CHROME_MESSAGE_TYPE = "miningqwq-shell-chrome";
  const SHELL_CHROME_MESSAGE_PREFIX = "miningqwq-shell-chrome:";
  const SHELL_CHROME_STORAGE_KEY = "miningqwq-desktop-shell-chrome-v1";
  const webview = window.chrome && window.chrome.webview;
  const frame = document.getElementById("app-frame");
  const toggleMaximizeButton = document.getElementById("toggle-maximize");
  const query = new URLSearchParams(window.location.search);
  const desktopAppUrl = query.get("appUrl") || "https://echo.miningqwq.cn/";
  let latestDesktopContext = null;
  let latestWindowState = null;

  if (frame) {
    frame.src = desktopAppUrl;
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return "desktop-shell-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function postDesktopAction(action, payload) {
    if (!webview || typeof webview.postMessage !== "function") {
      return;
    }

    webview.postMessage(
      JSON.stringify({
        type: DESKTOP_ACTION_TYPE,
        action,
        payload: payload || null,
        requestId: createRequestId()
      })
    );
  }

  function persistChromeTokens(tokens) {
    try {
      window.localStorage.setItem(SHELL_CHROME_STORAGE_KEY, JSON.stringify(tokens));
    } catch {
      // Ignore storage failures and fall back to live theme sync.
    }
  }

  function loadPersistedChromeTokens() {
    try {
      const raw = window.localStorage.getItem(SHELL_CHROME_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function forwardChromeTokensToHost(tokens) {
    if (!webview || typeof webview.postMessage !== "function" || !tokens || typeof tokens !== "object") {
      return;
    }

    webview.postMessage(SHELL_CHROME_MESSAGE_PREFIX + JSON.stringify(tokens));
  }

  function applyChromeTokens(tokens) {
    if (!tokens || typeof tokens !== "object") {
      return;
    }

    const root = document.documentElement;
    const body = document.body;
    body.dataset.mode = tokens.mode === "light" ? "light" : "dark";
    const tokenEntries = {
      "--shell-surface-background": tokens.surfaceBackground,
      "--shell-header-background": tokens.headerBackground,
      "--shell-header-border": tokens.headerBorder,
      "--shell-window-border": tokens.windowBorder,
      "--shell-title-foreground": tokens.titleForeground,
      "--shell-subtitle-foreground": tokens.subtitleForeground,
      "--shell-caption-foreground": tokens.captionForeground,
      "--shell-caption-hover-background": tokens.captionHoverBackground,
      "--shell-caption-pressed-background": tokens.captionPressedBackground,
      "--shell-close-hover-background": tokens.closeHoverBackground,
      "--shell-close-pressed-background": tokens.closePressedBackground,
      "--shell-radius-large": typeof tokens.radiusLarge === "number" ? tokens.radiusLarge + "px" : null
    };

    Object.entries(tokenEntries).forEach(([key, value]) => {
      if (typeof value === "string" && value) {
        root.style.setProperty(key, value);
      }
    });

    persistChromeTokens(tokens);
  }

  function applyWindowState(state) {
    if (!state || typeof state !== "object") {
      return;
    }

    document.body.dataset.maximized = state.isMaximized ? "true" : "false";
    document.body.dataset.active = state.isActive === false ? "false" : "true";
    if (toggleMaximizeButton) {
      toggleMaximizeButton.setAttribute("aria-label", state.isMaximized ? "还原" : "最大化");
    }
  }

  function forwardHostMessageToIframe(raw) {
    if (!frame || !frame.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage(raw, "*");
  }

  function handleDesktopHostMessage(raw) {
    const data = typeof raw === "string" ? (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })() : raw;

    if (!data || typeof data !== "object") {
      return;
    }

    if (data.type === DESKTOP_CONTEXT_TYPE || data.type === DESKTOP_WINDOW_STATE_TYPE || data.type === "miningqwq-desktop-action-result") {
      if (data.type === DESKTOP_CONTEXT_TYPE) {
        latestDesktopContext = data;
      }

      if (data.type === DESKTOP_WINDOW_STATE_TYPE) {
        latestWindowState = data;
      }

      forwardHostMessageToIframe(data);
    }

    if (data.type === DESKTOP_WINDOW_STATE_TYPE) {
      applyWindowState(data.data);
    }
  }

  if (frame) {
    frame.addEventListener("load", function () {
      if (latestDesktopContext) {
        forwardHostMessageToIframe(latestDesktopContext);
      }

      if (latestWindowState) {
        forwardHostMessageToIframe(latestWindowState);
      }
    });
  }

  const persistedChromeTokens = loadPersistedChromeTokens();
  if (persistedChromeTokens) {
    applyChromeTokens(persistedChromeTokens);
  }

  if (webview && typeof webview.addEventListener === "function") {
    webview.addEventListener("message", function (event) {
      handleDesktopHostMessage(event.data);
    });
  }

  window.addEventListener("message", function (event) {
    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }

    if (!frame || event.source !== frame.contentWindow || data.type !== SHELL_CHROME_MESSAGE_TYPE) {
      return;
    }

    applyChromeTokens(data.payload);
    forwardChromeTokensToHost(data.payload);
  });

  document.querySelectorAll("[data-action]").forEach(function (button) {
    button.addEventListener("click", function () {
      postDesktopAction(button.getAttribute("data-action"));
    });
  });
})();
