// Desktop lyric renderer. Runs inside the transparent lyric window (NavigateToString page, no network).
// Native posts {type:'frame', frame} and {type:'appearance', ...}; the page posts ready/drag/lock/close.
(() => {
  'use strict';

  // Same estimate as lineProgress in src/frontend/lib/lrc.ts: the timeline is per line, so the sweep
  // runs over the sung length (290 ms per character + 500 ms), capped by the gap to the next line.
  function sweep(text, start, end, time) {
    if (start == null || end == null) return 1;
    const sung = [...text].length * 290 + 500;
    const span = Math.max(400, Math.min(end - start, sung));
    return Math.min(1, Math.max(0, (time - start) / span));
  }

  // Interpolates between bridge updates the way NowPlaying reads audio time every frame.
  // Small backwards steps are message latency; anything larger is a seek and the newest frame wins.
  function createClock() {
    let anchor = null;
    const read = at => !anchor ? 0
      : anchor.playing ? anchor.position + Math.min(Math.max(0, at - anchor.at), 8000) : anchor.position;
    return {
      read,
      update(frame, at) {
        if (!frame || frame.start == null) { anchor = null; return; }
        const key = `${frame.title}\n${frame.artist}\n${frame.start}`;
        let position = frame.position;
        if (anchor?.key === key && anchor.playing && frame.playing) {
          const predicted = read(at);
          if (position < predicted && predicted - position < 250) position = predicted;
        }
        anchor = { key, position, at, playing: frame.playing };
      },
    };
  }

  // Which line change the renderer should animate.
  function transition(previous, frame) {
    if (!frame) return previous ? 'clear' : 'none';
    if (!previous) return 'enter';
    if (frame.title !== previous.title || frame.artist !== previous.artist) return 'replace';
    if (frame.primary !== previous.primary) return previous.secondary && frame.primary === previous.secondary ? 'advance' : 'replace';
    if (frame.start !== previous.start) return 'replace';
    if (frame.secondary !== previous.secondary) return 'secondary';
    return 'none';
  }

  const api = { sweep, createClock, transition };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  const bridge = window.chrome?.webview;
  const stage = document.getElementById('stage');
  const meta = document.getElementById('meta');
  const root = document.documentElement;
  const SPRING = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
  const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const clock = createClock();
  let current = null;
  let primary = null;
  let secondary = null;
  let raf = 0;

  const reduced = () => root.dataset.motion === 'reduced';
  const run = (el, frames, options) => reduced() ? null : el.animate(frames, options);

  function line(kind, text) {
    const el = document.createElement('div');
    el.className = `line ${kind}`;
    for (const name of ['halo', 'ink']) {
      const layer = document.createElement('div');
      layer.className = `layer ${name}`;
      const span = document.createElement('span');
      span.textContent = text;
      layer.append(span);
      if (name === 'halo') layer.setAttribute('aria-hidden', 'true');
      el.append(layer);
    }
    return el;
  }

  // Shrink long lines to fit one row first; only very long lines wrap, and the sweep then
  // continues onto the second row like the inline span in the player.
  function fit(el) {
    el.style.fontSize = '';
    el.classList.add('measure');
    const need = el.querySelector('.ink span').getBoundingClientRect().width;
    el.classList.remove('measure');
    const base = parseFloat(getComputedStyle(el).fontSize);
    const avail = stage.clientWidth;
    if (need > avail) el.style.fontSize = `${Math.max(base * 0.76, base * avail / need)}px`;
  }

  // Measure every outgoing row before taking any out of the flow, then fade them up and away.
  function leave(...rows) {
    const frame = stage.getBoundingClientRect();
    const boxes = rows.map(el => el && [el, el.getBoundingClientRect(), getComputedStyle(el).opacity]).filter(Boolean);
    for (const [el, box, opacity] of boxes) {
      if (reduced()) { el.remove(); continue; }
      Object.assign(el.style, { position: 'absolute', left: `${box.left - frame.left}px`, top: `${box.top - frame.top}px`, width: `${box.width}px` });
      el.classList.add('leaving');
      const animation = el.animate([
        { opacity, transform: 'none', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-12px) scale(0.97)', filter: 'blur(3px)' },
      ], { duration: 450, easing: EASE_OUT, fill: 'forwards' });
      animation.onfinish = () => el.remove();
    }
  }

  function enter(el, delay = 0) {
    // The player's line transition: scale 0.94 to 1 on a spring, opacity and blur on ease-out.
    run(el, [{ transform: 'translateY(10px) scale(0.94)' }, { transform: 'none' }], { duration: 700, easing: SPRING, delay, fill: 'backwards' });
    run(el, [{ opacity: 0, filter: 'blur(4px)' }, { opacity: getComputedStyle(el).opacity, filter: 'blur(0px)' }], { duration: 600, easing: EASE_OUT, delay, fill: 'backwards' });
  }

  function addSecondary(text, delay) {
    secondary = text ? line('secondary', text) : null;
    if (secondary) { stage.append(secondary); enter(secondary, delay); }
  }

  function render(frame) {
    const kind = transition(current, frame);
    const timed = frame?.start != null;
    if (kind === 'clear') {
      leave(primary, secondary);
      primary = secondary = null;
    } else if (kind === 'enter' || kind === 'replace') {
      leave(primary, secondary);
      primary = line('primary', frame.primary);
      stage.append(primary);
      fit(primary);
      enter(primary);
      addSecondary(frame.secondary, 60);
    } else if (kind === 'advance') {
      // The second row was the next line: lift it into place instead of swapping text.
      const promoted = secondary;
      const first = promoted.getBoundingClientRect();
      const from = parseFloat(getComputedStyle(promoted).fontSize);
      leave(primary);
      promoted.className = 'line primary';
      primary = promoted;
      addSecondary(frame.secondary, 60);
      fit(primary);
      const last = primary.getBoundingClientRect();
      const scale = from / parseFloat(getComputedStyle(primary).fontSize);
      run(primary, [
        { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${scale})`, opacity: 0.78 },
        { transform: 'none', opacity: 1 },
      ], { duration: 700, easing: SPRING });
    } else if (kind === 'secondary') {
      leave(secondary);
      addSecondary(frame.secondary, 60);
    }
    if (primary) primary.classList.toggle('timed', timed);
    meta.textContent = frame?.title ? [frame.title, frame.artist].filter(Boolean).join(' · ') : '';
    current = frame;
    clock.update(frame, performance.now());
    paint();
  }

  function paint() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!current || !primary || current.start == null) return;
    const progress = sweep(current.primary, current.start, current.end, clock.read(performance.now()));
    primary.style.setProperty('--p', `${(progress * 100).toFixed(1)}%`);
    if (current.playing && progress < 1) raf = requestAnimationFrame(paint);
  }

  function appearance(data) {
    const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
    root.dataset.theme = data.dark ? 'dark' : 'light';
    root.style.setProperty('--ink', color(data.ink) || (data.dark ? '#f1f0ec' : '#111111'));
    root.style.setProperty('--bg', color(data.bg) || (data.dark ? '#0d0d0e' : '#f3f2ee'));
    const locked = data.locked === true;
    if (root.classList.contains('locked') && !locked) {
      // Just unlocked from the tray or settings: show where the window is for a moment.
      root.classList.add('reveal');
      setTimeout(() => root.classList.remove('reveal'), 2600);
    }
    root.classList.toggle('locked', locked);
  }

  bridge?.addEventListener('message', ({ data }) => {
    if (data?.type === 'frame') {
      const frame = data.frame && typeof data.frame === 'object' ? data.frame : null;
      root.dataset.motion = frame?.reduced ? 'reduced' : '';
      render(frame);
    } else if (data?.type === 'appearance') appearance(data);
  });

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || root.classList.contains('locked')) return;
    const action = event.target.closest('button')?.dataset.action;
    if (action) return;
    event.preventDefault();
    bridge?.postMessage({ type: 'drag' });
  });
  document.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'lock' || action === 'close') bridge?.postMessage({ type: action });
  });
  document.addEventListener('contextmenu', event => event.preventDefault());
  addEventListener('resize', () => { if (primary) fit(primary); });
  bridge?.postMessage({ type: 'ready' });
})();
