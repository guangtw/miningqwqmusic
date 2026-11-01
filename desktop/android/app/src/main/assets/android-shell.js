(() => {
  'use strict';
  if (window.top !== window || location.origin !== 'https://echo.miningqwq.cn' || window.__miningAndroidShell) return;
  Object.defineProperty(window, '__miningAndroidShell', { value: true });
  const send = data => window.MiningAndroid?.postMessage(JSON.stringify(data));
  const pending = new Map();
  let sequence = 0;
  if (window.MiningAndroid) window.MiningAndroid.onmessage = event => {
    try {
      const reply = JSON.parse(event.data);
      const request = pending.get(reply.ack);
      if (!request) return;
      pending.delete(reply.ack);
      clearTimeout(request.timer);
      reply.ok ? request.resolve() : request.reject(new Error('Download failed'));
    } catch {}
  };
  const transfer = data => new Promise((resolve, reject) => {
    const ack = String(++sequence);
    const timer = setTimeout(() => { pending.delete(ack); reject(new Error('Download timeout')); }, 15000);
    pending.set(ack, { resolve, reject, timer });
    send({ ...data, ack });
  });
  const trusted = url => url.protocol === 'https:' && url.hostname === 'echo.miningqwq.cn' && (!url.port || url.port === '443') && !url.username && !url.password;
  const resolve = value => { try { return new URL(value, location.href); } catch { return null; } };

  // Native callbacks also deny all of these, including requests from subframes.
  window.alert = () => {};
  window.confirm = () => false;
  window.prompt = () => null;
  window.open = value => {
    const url = resolve(value);
    if (url && trusted(url)) send({ type: 'navigate', url: url.href });
    // The website's download fallback uses window.open for audio CDNs.
    else if (url && url.protocol === 'https:' && /\.(mp3|flac|m4a|aac|ogg|wav)(?:$|\?)/i.test(url.pathname + url.search))
      send({ type: 'download', url: url.href });
    return null;
  };
  addEventListener('beforeinstallprompt', event => event.preventDefault());
  addEventListener('contextmenu', event => event.preventDefault());
  const noCredentials = () => Promise.reject(new DOMException('Unavailable in this application', 'NotAllowedError'));
  for (const name of ['get', 'create', 'store', 'preventSilentAccess']) {
    try { if (navigator.credentials) Object.defineProperty(navigator.credentials, name, { value: noCredentials }); } catch {}
  }

  const disableAutofill = root => {
    const elements = root.querySelectorAll?.('input,textarea,form') || [];
    for (const element of elements) {
      element.setAttribute('autocomplete', element.type === 'password' ? 'new-password' : 'off');
      element.setAttribute('data-ms-editor', 'false');
    }
  };
  const blobDownload = async anchor => {
    const response = await fetch(anchor.href);
    const blob = await response.blob();
    if (blob.size > 256 * 1024 * 1024) return;
    const id = Math.random().toString(36).slice(2);
    await transfer({ type: 'blob-start', id, name: anchor.download || 'Music.mp3', mime: blob.type, size: blob.size });
    for (let offset = 0; offset < blob.size; offset += 48 * 1024) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + 48 * 1024).arrayBuffer());
      let data = '';
      for (const byte of bytes) data += String.fromCharCode(byte);
      await transfer({ type: 'blob-chunk', id, data: btoa(data) });
    }
    await transfer({ type: 'blob-end', id });
  };
  addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    const url = resolve(anchor.href);
    if (anchor.hasAttribute('download') && window.MiningAndroid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (url?.protocol === 'blob:') void blobDownload(anchor).catch(() => {});
      else if (url?.protocol === 'https:') send({ type: 'download', url: url.href, name: anchor.download });
    } else if (url && !trusted(url)) {
      event.preventDefault();
    } else if (anchor.target === '_blank') {
      event.preventDefault();
      send({ type: 'navigate', url: url.href });
    }
  }, true);

  const ready = () => {
    disableAutofill(document);
    new MutationObserver(() => disableAutofill(document)).observe(document.body, { childList: true, subtree: true });
    // Only remove browser affordances. Existing layout and toast/dialog components are untouched.
    const style = document.createElement('style');
    style.textContent = 'html,body{overscroll-behavior:none}::-webkit-scrollbar{display:none}a,img{-webkit-touch-callout:none}';
    document.head.append(style);
    const publishTheme = () => send({ type: 'state', dark: getComputedStyle(document.documentElement).colorScheme === 'dark' });
    publishTheme();
    new MutationObserver(publishTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', publishTheme);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
