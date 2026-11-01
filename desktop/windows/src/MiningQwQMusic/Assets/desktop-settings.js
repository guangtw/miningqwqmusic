(() => {
  'use strict';
  if (window.top !== window || location.origin !== 'https://echo.miningqwq.cn' || !window.chrome?.webview) return;
  const bridge = window.chrome.webview;
  const send = (action, value) => bridge.postMessage({ type: 'desktop-action', action, ...(typeof value === 'boolean' ? { value } : {}) });
  let settings = null;
  let scheduled = false;
  let form = null;
  let mounted = [];
  const buttons = new Map();

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const option = (label, action, value) => {
    const button = element('button', '', label);
    button.type = 'button';
    button.addEventListener('click', () => send(action, value));
    return button;
  };
  const field = (label, content, help) => {
    const row = element('div', 'field');
    row.dataset.shellSetting = '';
    const body = element('div');
    body.append(content);
    if (help) body.append(element('p', 'help', help));
    row.append(element('span', 'label', label), body);
    return row;
  };
  const choice = (label, options) => {
    const group = element('div', 'seg');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    for (const [text, action, value] of options) {
      const button = option(text, action, value);
      button.setAttribute('role', 'radio');
      buttons.set(`${action}:${value}`, button);
      group.append(button);
    }
    return group;
  };
  const sync = () => {
    scheduled = false;
    const route = location.hash.slice(1);
    const isSettings = route.split('?')[0] === '/settings' || /^\/account\?.*\btab=settings(?:&|$)/.test(route);
    const target = isSettings ? document.querySelector('.main .form') : null;
    if (!settings || !target) { mounted.forEach(node => node.remove()); mounted = []; form = null; buttons.clear(); return; }
    if (form !== target || mounted.some(node => node.parentElement !== target)) {
      mounted.forEach(node => node.remove());
      buttons.clear();
      form = target;
      const actions = element('div', 'field-inline');
      actions.append(option('查看下载', 'downloads'), option('重新加载', 'reload'), option('退出唱片行', 'exit'));
      for (const button of actions.children) button.className = 'btn';
      const windowButtons = element('div', 'seg');
      const fullscreen = option(settings.fullScreen ? '退出全屏' : '进入全屏', 'fullScreen');
      buttons.set('fullScreen', fullscreen);
      windowButtons.append(fullscreen);
      mounted = [
        field('关闭窗口时', choice('关闭窗口时', [['收进托盘', 'closeToTray', true], ['直接退出', 'closeToTray', false]]), '收进托盘后继续播放。可在托盘菜单中控制播放或退出。'),
        field('窗口', windowButtons),
        field('应用', actions),
      ];
      target.append(...mounted);
    }
    for (const value of [true, false]) {
      const button = buttons.get(`closeToTray:${value}`);
      const checked = settings.closeToTray === value;
      if (button.getAttribute('aria-checked') !== String(checked)) {
        button.setAttribute('aria-checked', String(checked));
        button.classList.toggle('on', checked);
      }
    }
    const label = settings.fullScreen ? '退出全屏' : '进入全屏';
    if (buttons.get('fullScreen').textContent !== label) buttons.get('fullScreen').textContent = label;
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } };
  bridge.addEventListener('message', ({ data }) => {
    if (data?.type !== 'desktop-settings' || data.protocol !== 1 || typeof data.closeToTray !== 'boolean' || typeof data.fullScreen !== 'boolean') return;
    settings = { closeToTray: data.closeToTray, fullScreen: data.fullScreen };
    schedule();
  });
  addEventListener('DOMContentLoaded', () => {
    bridge.postMessage({ type: 'desktop-ready' });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    addEventListener('hashchange', schedule);
    schedule();
  }, { once: true });
})();
