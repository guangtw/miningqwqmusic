import type { Track } from '../api';
import { createStore } from '../lib/store';

export type PlaylistDialog = { mode: 'create'; tracks?: Track[]; open?: boolean } | { mode: 'edit'; id: string };

/** 曲目菜单：在哪儿弹、对哪几首歌；在自建歌单里打开时带上歌单和行号，菜单里多一个「移除」 */
export interface TrackMenu {
  tracks: Track[];
  x: number;
  y: number;
  /** 菜单尽量开在锚点的哪一侧 */
  below: boolean;
  from?: { playlistId: string; index: number };
  /** 只显示「加到歌单」部分（整张歌单批量加的时候） */
  addOnly?: boolean;
  /** 打开菜单的按钮；再点一次是收起 */
  anchor?: Element;
}

/** 浮层开关：正在播放页、队列抽屉、登录框、歌单对话框、导入框、曲目菜单、一起听 */
export const uiStore = createStore({
  nowPlaying: false,
  queue: false,
  login: false,
  playlist: null as PlaylistDialog | null,
  importing: false,
  menu: null as TrackMenu | null,
  /** 一起听抽屉 */
  listen: false,
});

/** 从一个按钮（或右键位置）弹出曲目菜单 */
export function openTrackMenu(e: React.MouseEvent, tracks: Track[], extra: Partial<TrackMenu> = {}) {
  e.preventDefault();
  e.stopPropagation();
  const anchor = e.currentTarget as HTMLElement;
  const atPointer = e.type === 'contextmenu';
  if (!atPointer && uiStore.get().menu?.anchor === anchor) return uiStore.set({ menu: null });
  const r = anchor.getBoundingClientRect();
  const x = atPointer ? e.clientX : r.right;
  const y = atPointer ? e.clientY : r.bottom;
  uiStore.set({ menu: { tracks, x, y, below: y < window.innerHeight * 0.55, anchor: atPointer ? undefined : anchor, ...extra } });
}
