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
      if (reply.type === 'media-command') {
        window.dispatchEvent(new CustomEvent('android-media-command', { detail: reply }));
        return;
      }
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

  // Set-Cookie is processed before fetch resolves, but WebView may leave it only
  // in memory until a later disk flush. A rotating refresh cookie must be durable
  // before the caller receives a successful authentication response.
  const fetch = window.fetch.bind(window);
  // Share the page's lyric response. Keep a small per-song cache so a late
  // response from the previous song cannot replace the current timeline.
  const lyricRequests = new Map();
  const lyricPath = /^\/api\/music\/track\/([^/]+)\/lyric\/?$/;
  function readTimeline(response, id) {
    if (!response.ok) return [];
    return response.json().then(({ data }) => {
      if (String(data?.trackId) !== id || !Array.isArray(data.lines)) return [];
      const lines = data.lines.filter(line => Number.isFinite(line.timeMs) && line.text?.trim())
        .sort((a, b) => a.timeMs - b.timeMs);
      return lines.length > 1 && lines.every(line => line.timeMs === 0) ? [] : lines;
    });
  }
  window.fetch = async (...args) => {
    const request = fetch(...args);
    const url = resolve(args[0] instanceof Request ? args[0].url : args[0]);
    const match = window.MiningAndroid && url && trusted(url) && lyricPath.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      lyricRequests.set(id, request.then(response => readTimeline(response.clone(), id)).catch(() => []));
      if (lyricRequests.size > 4) lyricRequests.delete(lyricRequests.keys().next().value);
    }
    const response = await request;
    if (window.MiningAndroid && response.ok && url && trusted(url)
      && /^\/api\/account\/auth\/(login|register|refresh|logout|logout-all|change-password)\/?$/.test(url.pathname))
      await transfer({ type: 'persist-session' });
    return response;
  };

  // Upgrade passive resources before WebView's mixed-content check. Keep data/
  // blob URLs intact (generated artwork and downloaded files depend on them).
  const secureResourceUrl = value => {
    if (typeof value !== 'string' || !/^http:\/\//i.test(value)) return value;
    const url = resolve(value);
    if (!url || url.protocol !== 'http:') return value;
    url.protocol = 'https:';
    return url.href;
  };
  const secureSrcset = value => typeof value === 'string'
    ? value.replace(/(^|[\s,])http:\/\//gi, '$1https://') : value;
  for (const [prototype, attribute, normalize] of [
    [HTMLMediaElement.prototype, 'src', secureResourceUrl],
    [HTMLImageElement.prototype, 'src', secureResourceUrl],
    [HTMLImageElement.prototype, 'srcset', secureSrcset],
    [HTMLSourceElement.prototype, 'src', secureResourceUrl],
    [HTMLSourceElement.prototype, 'srcset', secureSrcset],
    [HTMLVideoElement.prototype, 'poster', secureResourceUrl],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, attribute);
    if (!descriptor?.set) continue;
    Object.defineProperty(prototype, attribute, {
      ...descriptor,
      set(value) { descriptor.set.call(this, normalize(value)); },
    });
  }
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const attribute = String(name).toLowerCase();
    if ((attribute === 'src' || attribute === 'srcset' || attribute === 'poster')
      && (this instanceof HTMLImageElement || this instanceof HTMLMediaElement || this instanceof HTMLSourceElement))
      value = attribute === 'srcset' ? secureSrcset(value) : secureResourceUrl(value);
    return setAttribute.call(this, name, value);
  };
  if (window.MediaMetadata) {
    const Metadata = window.MediaMetadata;
    window.MediaMetadata = class extends Metadata {
      constructor(init = {}) {
        super({ ...init, artwork: Array.from(init.artwork || [], art => ({ ...art, src: secureResourceUrl(art.src) })) });
      }
    };
  }

  // Use the site's transport handlers so queue navigation, URL renewal and fades
  // follow the same path as a tap in the player. Its Audio element is detached.
  function connectMediaControls() {
    if (!window.MiningAndroid) return;
    // Android WebView can omit the Web Media Session API. Expose the subset
    // the online player uses before it registers its queue transport handlers.
    if (!window.MediaMetadata) {
      window.MediaMetadata = class {
        constructor({ title = '', artist = '', album = '', artwork = [] } = {}) {
          Object.assign(this, { title, artist, album, artwork: artwork.map(art => ({ ...art, src: secureResourceUrl(art.src) })) });
        }
      };
    }
    if (!navigator.mediaSession) Object.defineProperty(navigator, 'mediaSession', {
      value: { metadata: null, setActionHandler() {} },
    });
    const session = navigator.mediaSession;
    const handlers = new Map();
    const register = session.setActionHandler.bind(session);
    session.setActionHandler = (action, callback) => {
      try { register(action, callback); } catch (error) {
        if (error.name !== 'NotSupportedError') throw error;
      }
      if (callback) handlers.set(action, callback);
      else handlers.delete(action);
    };
    const actions = { play: 'play', pause: 'pause', previous: 'previoustrack', next: 'nexttrack', seek: 'seekto' };
    addEventListener('android-media-command', ({ detail }) => {
      const action = actions[detail.action];
      const handler = handlers.get(action);
      if (handler) return handler({ action, seekTime: detail.position / 1000 });
      // Older WebViews install this script after the site registered its handlers.
      if (!active) return;
      if (action === 'seekto') {
        if (Number.isFinite(active.duration)) active.currentTime = Math.min(active.duration, detail.position / 1000);
        return;
      }
      const labels = { play: '播放', pause: '暂停', nexttrack: '下一首', previoustrack: '上一首' };
      if (labels[action]) document.querySelector('.player button[aria-label="' + labels[action] + '"]')?.click();
    });

    let active;
    let lastCover;
    let source;
    let sequence = 0;
    let track;
    let timeline = [];
    let lastLine = '';
    function lineAtPosition() {
      let lo = 0, hi = timeline.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (timeline[mid].timeMs <= active.currentTime * 1000) lo = mid + 1;
        else hi = mid;
      }
      return timeline[lo - 1]?.text.trim().slice(0, 512) || '';
    }
    const syncLine = () => { if (lastLine !== lineAtPosition()) publish(); };
    function loadTrack() {
      track = null;
      timeline = [];
      try {
        const saved = JSON.parse(localStorage.getItem('cph.player.v2'));
        track = saved?.queue?.[saved.index];
      } catch {}
      if (!track?.id) return;
      const id = String(track.id);
      const token = sequence;
      const request = lyricRequests.get(id) || fetch('/api/music/track/' + encodeURIComponent(id) + '/lyric')
        .then(response => readTimeline(response, id)).catch(() => []);
      request.then(lines => {
        if (sequence !== token) return;
        timeline = lines;
        syncLine();
      });
    }
    const publishCover = (url, id) => {
      if (!url) return;
      const cover = new Image();
      cover.crossOrigin = 'anonymous';
      cover.onload = () => {
        if (sequence !== id || url !== lastCover) return;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        try {
          canvas.getContext('2d').drawImage(cover, 0, 0, 256, 256);
          send({ type: 'playback-art', id, jpeg: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] });
        } catch { /* Some providers do not permit pixel access. */ }
      };
      const thumbnail = resolve(url);
      if (thumbnail?.protocol === 'https:' && /^p\d+\.music\.126\.net$/i.test(thumbnail.hostname)) {
        thumbnail.searchParams.set('param', '256y256');
        cover.src = thumbnail.href;
      } else cover.src = url;
    };
    const publish = event => {
      if (!active.getAttribute('src') || active.error) {
        source = lastCover = undefined;
        timeline = [];
        lastLine = '';
        sequence++;
        send({ type: 'playback' });
        return;
      }
      const meta = session.metadata;
      // Assigning the same CDN URL again can still select a different track.
      if (source !== active.src || event?.type === 'loadstart') {
        source = active.src;
        sequence++;
        lastCover = undefined;
        loadTrack();
      }
      const status = active.paused || active.ended ? 'paused'
        : active.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ? 'buffering' : 'playing';
      lastLine = lineAtPosition();
      const url = secureResourceUrl(track ? track.coverUrl || track.album?.coverUrl : meta?.artwork?.[0]?.src);
      send({ type: 'playback', id: sequence, title: track?.name || meta?.title || '音乐播放',
        artist: (track ? track.artists?.map(artist => artist.name).join(' / ') : meta?.artist) || '',
        album: (track ? track.album?.name : meta?.album) || '', lyric: lastLine,
        cover: url?.startsWith('https://') ? url : '', status,
        duration: Number.isFinite(active.duration) ? Math.round(active.duration * 1000) : 0,
        position: Math.round(active.currentTime * 1000) });
      if (url !== lastCover) {
        lastCover = url;
        publishCover(url, sequence);
      }
    };
    const events = ['loadstart', 'playing', 'waiting', 'pause', 'seeked', 'durationchange', 'ended', 'emptied', 'error'];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement && (handlers.has('play') || document.querySelector('.player .play-btn')) && this !== active) {
        if (active) {
          for (const name of events) active.removeEventListener(name, publish);
          active.removeEventListener('timeupdate', syncLine);
        }
        active = this;
        active.addEventListener('timeupdate', syncLine);
        for (const name of events) active.addEventListener(name, publish);
      }
      return play.call(this);
    };
  }
  connectMediaControls();

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
