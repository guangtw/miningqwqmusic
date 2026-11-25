(() => {
  'use strict';
  if (window.top !== window || location.origin !== 'https://echo.miningqwq.cn' || !window.chrome?.webview) return;
  const bridge = window.chrome.webview;
  const text = (root, selector) => root?.querySelector(selector)?.textContent?.trim() || '';
  let observer = null;
  let last = '';
  let timeline = null;

  // Cache timestamps for the sweep, including when the player unmounts its lyric list.
  function readTimeline(track) {
    if (timeline?.track === track) return timeline;
    timeline?.controller.abort();
    const entry = timeline = { track, controller: new AbortController(), lines: [], status: '正在找歌词…' };
    (async () => {
      try {
        const player = JSON.parse(localStorage.getItem('cph.player.v2'));
        const id = player?.queue?.[player.index]?.id;
        if (!id) throw new Error();
        const response = await fetch(`/api/music/track/${encodeURIComponent(id)}/lyric`, { signal: entry.controller.signal });
        if (!response.ok) throw new Error();
        const { data } = await response.json();
        const translations = new Map((data.translatedLines || []).map(line => [line.timeMs, line.text]));
        entry.lines = data.lines.filter(line => Number.isFinite(line.timeMs) && line.text?.trim())
          .map(line => ({ ...line, translation: translations.get(line.timeMs) }));
        entry.status = entry.lines.length ? '前奏' : '暂无歌词';
        if (entry.lines.length > 1 && entry.lines.every(line => line.timeMs === 0)) {
          entry.status = '暂无逐行歌词';
          entry.lines = [];
        }
      } catch {
        entry.status = '暂时无法获取歌词';
      }
      if (timeline === entry && observer) publish();
    })();
    return entry;
  }

  function publish() {
    const track = document.querySelector('.player .np-swap');
    const title = text(track, '.np-title');
    const artist = text(track, '.np-artist');
    const panel = document.querySelector('.nowplaying');
    let primary = '唱机空着';
    let secondary = '选一首歌，歌词会在这里出现';
    let start = null;
    let end = null;
    const position = Number(document.querySelector('.player [aria-label="播放进度"]')?.getAttribute('aria-valuenow')) + 220;
    if (track) {
      const { lines, status } = readTimeline(track);
      const next = lines.findIndex(line => line.timeMs > position);
      const index = next < 0 ? lines.length - 1 : next - 1;
      const line = lines[index];
      const active = panel?.querySelector('.lyric-line.active');
      primary = text(active, 'span') || line?.text || text(panel, '.lyrics-empty') || status;
      secondary = text(active, 'small') || text(active?.nextElementSibling, 'span') ||
        (line?.translation !== line?.text && line?.translation) || lines[index + 1]?.text || '';
      if (line && primary === line.text) {
        start = line.timeMs;
        end = lines[index + 1]?.timeMs ?? start + 6000;
      }
      if (panel?.querySelector('.lyrics.unsynced')) {
        primary = text(panel, '.lyric-line > span') || '暂无逐行歌词';
        secondary = '暂无逐行歌词';
        start = null;
        end = null;
      }
    } else {
      timeline?.controller.abort();
      timeline = null;
    }
    const data = { type: 'desktop-lyric', title: title.slice(0, 120), artist: artist.slice(0, 100),
      primary: primary.slice(0, 200), secondary: secondary.slice(0, 200), start, end,
      position: start === null ? 0 : position, playing: !!document.querySelector('.player .play-btn.is-playing'),
      reduced: document.documentElement.dataset.motion === 'reduced' };
    const signature = JSON.stringify(data);
    if (last !== signature) { last = signature; bridge.postMessage(data); }
  }

  bridge.addEventListener('message', ({ data }) => {
    if (data?.type !== 'desktop-settings' || data.protocol !== 1) return;
    const enabled = data.desktopLyrics === true;
    if (enabled === !!observer || !document.body) return;
    if (enabled) {
      observer = new MutationObserver(publish);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'aria-valuenow'] });
      publish();
    } else {
      observer.disconnect();
      observer = null;
      timeline?.controller.abort();
      timeline = null;
      last = '';
    }
  });
})();
