const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sweep, createClock, transition } = require('../src/MiningQwQMusic/Assets/desktop-lyrics-view.js');

test('sweep matches the player lineProgress for every line of a timeline', async () => {
  // Node 22 strips the type-only import in lrc.ts.
  const { lineProgress } = await import(path.join(__dirname, '../../../src/frontend/lib/lrc.ts'));
  const lines = [
    { timeMs: 1000, text: '我们的歌声穿过夜色' },
    { timeMs: 5000, text: '短' },
    { timeMs: 5300, text: 'A much longer English line that takes a while to sing' },
    { timeMs: 30000, text: '最后一句' },
  ];
  for (let i = 0; i < lines.length; i++) {
    const end = lines[i + 1]?.timeMs ?? lines[i].timeMs + 6000; // as published by desktop-lyrics.js
    for (let t = lines[i].timeMs - 500; t < end + 500; t += 97)
      assert.equal(sweep(lines[i].text, lines[i].timeMs, end, t), lineProgress(lines, i, t), `${i}@${t}`);
  }
  assert.equal(sweep('暂无逐行歌词', null, null, 0), 1, 'untimed lines are shown fully lit');
});

test('clock interpolates while playing, freezes on pause and follows seeks', () => {
  const clock = createClock();
  const frame = { title: '曲', artist: '人', primary: '句', start: 1000, end: 5000, position: 2000, playing: true };
  clock.update(frame, 100);
  assert.equal(clock.read(600), 2500);
  // Same line, a frame that trails the interpolated time by message latency: no step back.
  clock.update({ ...frame, position: 2450 }, 600);
  assert.equal(clock.read(600), 2500);
  // Backward seek inside the same line: the newest frame wins.
  clock.update({ ...frame, position: 1200 }, 700);
  assert.equal(clock.read(700), 1200);
  // Forward seek.
  clock.update({ ...frame, position: 4000 }, 800);
  assert.equal(clock.read(900), 4100);
  // Pause holds still, resume restarts from the paused frame.
  clock.update({ ...frame, position: 4200, playing: false }, 1000);
  assert.equal(clock.read(5000), 4200);
  clock.update({ ...frame, position: 4200 }, 6000);
  assert.equal(clock.read(6100), 4300);
  // A stalled bridge cannot run the sweep away forever.
  assert.equal(clock.read(6000 + 60000), 4200 + 8000);
  clock.update(null, 7000);
  assert.equal(clock.read(8000), 0);
});

test('line changes pick the player transition', () => {
  const a = { title: '曲', artist: '人', primary: '第一句', secondary: '第二句', start: 1000 };
  assert.equal(transition(null, null), 'none');
  assert.equal(transition(null, a), 'enter');
  assert.equal(transition(a, { ...a, position: 2000 }), 'none');
  assert.equal(transition(a, { ...a, primary: '第二句', secondary: '第三句', start: 4000 }), 'advance');
  assert.equal(transition(a, { ...a, primary: '第五句', secondary: '第六句', start: 9000 }), 'replace', 'seek');
  assert.equal(transition(a, { ...a, start: 7000 }), 'replace', 'repeated line restarts the sweep');
  assert.equal(transition(a, { ...a, secondary: 'Translation' }), 'secondary');
  assert.equal(transition(a, { ...a, title: '下一首' }), 'replace', 'track change');
  assert.equal(transition(a, null), 'clear');
});
