const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const script = readFileSync(require('node:path').join(__dirname, '../src/MiningQwQMusic/Assets/desktop-lyrics.js'), 'utf8');

function node(children = {}) {
  return { children, querySelector(selector) { return this.children[selector]; } };
}
function fixture() {
  const track = node({ '.np-title': { textContent: '曲名' }, '.np-artist': { textContent: '歌手' } });
  const panel = node();
  const document = node({ '.player .np-swap': track, '.nowplaying': panel });
  document.body = {};
  document.documentElement = {dataset:{}};
  const messages = [], requests = [];
  const callbacks = {};
  const window = { chrome: { webview: {
    postMessage: value => messages.push(value), addEventListener: (_, fn) => { callbacks.message = fn; }
  } } };
  window.top = window;
  vm.runInNewContext(script, { window, document, location: { origin: 'https://echo.miningqwq.cn' }, AbortController,
    localStorage: { getItem: () => JSON.stringify({ queue: [{id:'1'}], index: 0 }) },
    fetch: () => new Promise(resolve => requests.push(data => resolve({ok:true, json:async () => ({data})}))),
    MutationObserver: class {
      constructor(fn) { callbacks.mutate = fn; }
      observe() {}
      disconnect() { delete callbacks.mutate; }
    }
  });
  const mode = enabled => callbacks.message({ data: {type:'desktop-settings', protocol:1, desktopLyrics:enabled} });
  return { track, panel, document, messages, requests, callbacks, mode };
}

test('mirrors the active line, prefers translation, deduplicates and detaches on hide', () => {
  const f = fixture();
  const line = node({span:{textContent:'原文'}, small:{textContent:'译文'}});
  line.nextElementSibling = node({span:{textContent:'下一句'}});
  f.panel.children['.lyric-line.active'] = line;
  f.mode(true);
  assert.equal(f.messages.at(-1).secondary, '译文');
  f.callbacks.mutate();
  assert.equal(f.messages.length, 1);
  delete line.children.small;
  f.callbacks.mutate();
  assert.equal(f.messages.at(-1).secondary, '下一句');
  delete f.document.children['.player .np-swap'];
  f.callbacks.mutate();
  assert.equal(f.messages.at(-1).primary, '唱机空着');
  f.mode(false);
  assert.equal(f.callbacks.mutate, undefined);
  f.mode(true);
  assert.equal(f.messages.length, 4);
  assert.equal(f.requests.length, 1);
});

test('liner notes stay synchronized on seek and ignore late responses after track changes', async () => {
  const f = fixture();
  f.panel.children['.notes'] = node();
  let position = 5000;
  f.document.children['.player [aria-label="播放进度"]'] = {getAttribute: () => String(position)};
  f.mode(true);
  f.document.children['.player .np-swap'] = node({'.np-title':{textContent:'第二首'}});
  f.callbacks.mutate();
  assert.equal(f.requests.length, 2);
  f.requests[1]({lines:[{timeMs:1000,text:'第一句'}, {timeMs:5000,text:'第二句'}], translatedLines:[{timeMs:5000,text:'译文'}]});
  f.requests[0]({lines:[{timeMs:0,text:'旧歌曲'}]});
  await new Promise(setImmediate);
  assert.equal(f.messages.at(-1).primary, '第二句');
  assert.equal(f.messages.at(-1).secondary, '译文');
  assert.equal(f.messages.at(-1).start, 5000);
  assert.equal(f.messages.at(-1).position, 5220);
  position = 800;
  f.callbacks.mutate();
  assert.equal(f.messages.at(-1).primary, '第一句');
  position = 0;
  f.callbacks.mutate();
  assert.equal(f.messages.at(-1).primary, '前奏');
});
