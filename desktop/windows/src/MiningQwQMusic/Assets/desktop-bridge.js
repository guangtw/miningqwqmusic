(() => {
  'use strict';
  if (window.top !== window || location.origin !== 'https://echo.miningqwq.cn' || !window.chrome?.webview) return;
  let captionInset = 138;
  let captionSignature = '';
  let captionScheduled = false;
  const updateCaption = () => {
    captionScheduled = false;
    const limit = Math.max(0, (window.innerWidth || 0) - captionInset);
    const occupied = [];
    if (document.documentElement.dataset.desktopFullscreen !== 'true') {
      for (const element of document.querySelectorAll('.side a, .side button, .np-head button, header button, [role="dialog"] button')) {
        const r = element.getBoundingClientRect();
        if (r.height > 0 && r.top < 24 && r.bottom > 0 && r.right > 0 && r.left < limit)
          occupied.push([Math.max(0, r.left - 4), Math.min(limit, r.right + 4)]);
      }
    }
    const regions = [];
    let cursor = 0;
    for (const [left, right] of occupied.sort((a, b) => a[0] - b[0])) {
      if (left > cursor) regions.push({ x: cursor, width: left - cursor });
      cursor = Math.max(cursor, right);
    }
    if (limit > cursor && document.documentElement.dataset.desktopFullscreen !== 'true') regions.push({ x: cursor, width: limit - cursor });
    const signature = JSON.stringify(regions);
    if (captionSignature !== signature) { captionSignature = signature; send('caption-layout', { regions: regions.slice(0, 32) }); }
  };
  const scheduleCaption = () => { if (!captionScheduled) { captionScheduled = true; requestAnimationFrame(updateCaption); } };
  const send = (type, payload = {}) => window.chrome.webview.postMessage({ type, ...payload });
  const commands = {
    play: () => document.querySelector('.player .play-btn')?.click(),
    previous: () => document.querySelector('.player [aria-label="上一首"]')?.click(),
    next: () => document.querySelector('.player [aria-label="下一首"]')?.click(),
  };
  window.chrome.webview.addEventListener('message', ({ data }) => {
    if (data.type === 'command' && Object.hasOwn(commands, data.command)) commands[data.command]();
    if (data.type === 'window') {
      document.documentElement.dataset.desktopFullscreen = String(!!data.fullScreen);
      captionInset = Number.isFinite(data.captionInset) ? Math.max(0, data.captionInset) : 138;
      document.documentElement.style.setProperty('--caption-inset', `${captionInset}px`);
      scheduleCaption();
    }
  });
  let last = '';
  const publish = () => {
    const title = document.querySelector('.player .np-title')?.textContent || '';
    const artist = document.querySelector('.player .np-artist')?.textContent || '';
    const playing = !!document.querySelector('.player .play-btn.is-playing');
    const theme = document.documentElement.dataset.theme || 'auto';
    const css = getComputedStyle(document.documentElement);
    const palette = Object.fromEntries(['bg', 'surface', 'surface-2', 'ink', 'ink-2'].map(key => [key, css.getPropertyValue(`--${key}`).trim()]));
    const dark = css.colorScheme === 'dark';
    const key = JSON.stringify([title, artist, playing, theme, palette, dark, location.hash]);
    if (last !== key) {
      last = key;
      send('state', { title: title.slice(0, 240), artist: artist.slice(0, 240), playing, theme, dark, palette });
    }
  };
  addEventListener('DOMContentLoaded', () => {
    document.documentElement.dataset.desktop = 'windows';
    const style = document.createElement('style');
    style.textContent = `
      html { --caption-inset: 138px; overscroll-behavior: none; }
      html[data-desktop-fullscreen="true"] { --caption-inset: 0px; }
      body { overscroll-behavior: none; -webkit-user-select: none; user-select: none; }
      button,a,img { -webkit-user-drag: none; }
      html :is(input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-selectable="true"]),
      html :is([contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-selectable="true"]) * {
        -webkit-user-select: text; user-select: text;
      }
      html .np-head { padding-right: max(clamp(var(--gutter), 5vw, 140px), calc(var(--caption-inset) + 12px)); }
      html .keys-section { display: none; }
      @media (max-width: 860px) {
        html .side { padding-right: calc(var(--gutter) + var(--caption-inset)); }
      }
    `;
    document.head.append(style);
    publish();
    setInterval(publish, 1000);
    addEventListener('resize', scheduleCaption);
    addEventListener('scroll', scheduleCaption, { capture: true, passive: true });
    new MutationObserver(scheduleCaption).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    scheduleCaption();
  }, { once: true });
  addEventListener('beforeinstallprompt', event => event.preventDefault());
})();
