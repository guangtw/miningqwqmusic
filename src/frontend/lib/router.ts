import { useSyncExternalStore } from 'react';
import { browserAnimatedNav } from './backstack';
import { transition } from './motion';

// hash 路由：#/playlist/123?x=1。部署成静态文件时不需要服务端配置。

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
  /** 进入这一页时主区域应该滚到哪：新页面是 0，返回时是离开时的位置 */
  scrollY: number;
}

function parse(scrollY = 0): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, qs = ''] = raw.split('?');
  return { path: p, parts: p.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  }), query: new URLSearchParams(qs), scrollY };
}

let route = parse();
const listeners = new Set<() => void>();

// 自己记一份浏览栈，离开一页时存下滚动位置；回到上一条记录就算「返回」，恢复当时的位置，
// 这样封面才能飞回它原来所在的那张卡片
const stack: { hash: string; y: number }[] = [{ hash: location.hash, y: 0 }];

function track(): number {
  const top = stack[stack.length - 1];
  top.y = document.querySelector<HTMLElement>('.main')?.scrollTop ?? 0;
  if (stack.length > 1 && stack[stack.length - 2].hash === location.hash) {
    stack.pop();
    return stack[stack.length - 1].y;
  }
  stack.push({ hash: location.hash, y: 0 });
  return 0;
}

window.addEventListener('hashchange', () => {
  const next = parse(track());
  // 只改了查询参数（例如搜索翻页）不做整页过渡；系统侧滑返回自己演过一遍了，也不再演
  const samePage = next.path === route.path || browserAnimatedNav();
  const apply = () => {
    route = next;
    listeners.forEach((fn) => fn());
  };
  if (samePage) apply();
  else transition(apply, 'page');
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => route,
  );
}

export function navigate(to: string) {
  location.hash = to;
}

export const href = {
  home: () => '#/',
  playlist: (id: string) => `#/playlist/${encodeURIComponent(id)}`,
  toplist: (id: string) => `#/toplist/${encodeURIComponent(id)}`,
  album: (id: string) => `#/album/${encodeURIComponent(id)}`,
  artist: (id: string) => `#/artist/${encodeURIComponent(id)}`,
  search: (q?: string, type?: string) =>
    `#/search${q ? `?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}` : ''}`,
  mine: (id: string) => `#/mine/${encodeURIComponent(id)}`,
  charts: () => '#/charts',
  radio: () => '#/radio',
  library: () => '#/library',
  settings: () => '#/settings',
  /** 问与答；topic 对应页面里的一节，进来时滚到那里 */
  help: (topic?: string) => `#/help${topic ? `?q=${encodeURIComponent(topic)}` : ''}`,
  admin: () => '#/admin',
  account: () => '#/account',
  accountSettings: () => '#/account?tab=settings',
  friends: () => '#/friends',
  chat: (userId: string) => `#/chat/${encodeURIComponent(userId)}`,
  /** 私信里别人分享的自建歌单（快照只属于这条消息） */
  shared: (userId: string, messageId: string) => `#/chat/${encodeURIComponent(userId)}/shared/${encodeURIComponent(messageId)}`,
};
