const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const script = readFileSync(require('node:path').join(__dirname, '../src/MiningQwQMusic/Assets/desktop-bridge.js'), 'utf8');
function fixture(origin, isTop = true) {
  const events = {}, messages = [], clicks = [], styles = [];
  const window = { chrome: { webview: { postMessage: value => messages.push(value), addEventListener: (type, action) => events[type] = action } } };
  window.top = isTop ? window : {};
  const properties = {};
  const context = { window, location: { origin, hash: '#/' }, requestAnimationFrame() {}, MutationObserver: class { observe() {} }, getComputedStyle: () => ({colorScheme:'light',getPropertyValue:()=> '#f3f2ee'}), setInterval() {}, addEventListener: (type, action) => events[type] = action,
    document: { body:{}, documentElement: { dataset: {}, style:{setProperty:(key,value)=>properties[key]=value} }, head: { append(style) { styles.push(style.textContent); } }, createElement: () => ({}), querySelectorAll:()=>[], querySelector: selector => selector.includes('np-title') ? { textContent: 'Test Song' } : selector.includes('np-artist') ? { textContent: 'Artist' } : { click: () => clicks.push(selector) } } };
  vm.runInNewContext(script, context);
  return { events, messages, clicks, styles, properties, document:context.document };
}
test('bridge is absent on untrusted origins and child frames', () => {
  assert.equal(Object.keys(fixture('https://evil.test').events).length, 0);
  assert.equal(Object.keys(fixture('https://echo.miningqwq.cn', false).events).length, 0);
});
test('window geometry updates only the local caption safe area', () => {
  const f = fixture('https://echo.miningqwq.cn');
  f.events.DOMContentLoaded();
  f.events.message({data:{type:'window',fullScreen:true,captionInset:0}});
  assert.equal(f.document.documentElement.dataset.desktopFullscreen, 'true');
  assert.equal(f.properties['--caption-inset'], '0px');
  assert.equal(f.messages[0].palette.bg, '#f3f2ee');
});
test('native commands use website controls and unknown commands do nothing', () => {
  const f = fixture('https://echo.miningqwq.cn');
  for (const command of ['play', 'previous', 'next', 'unknown', '__proto__', 'constructor']) f.events.message({ data: { type: 'command', command } });
  assert.equal(f.clicks.length, 3);
  f.events.DOMContentLoaded();
  assert.equal(f.messages[0].title, 'Test Song');
  assert.equal(f.messages[0].artist, 'Artist');
});
