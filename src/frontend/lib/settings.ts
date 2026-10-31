import type { PlayQualityLevel } from '../api/types';
import { defaultQuality } from '../config/site';
import { readJSON, writeJSON } from './storage';

export type Theme = 'paper' | 'night' | 'auto';

export interface Settings {
  quality: PlayQualityLevel;
  theme: Theme;
  /** 尊重系统「减少动态效果」之外，用户也可以手动关掉大部分动画 */
  motion: 'full' | 'reduced';
}

const KEY = 'cph.settings.v2';

const defaults: Settings = { quality: defaultQuality, theme: 'auto', motion: 'full' };

let current: Settings = { ...defaults, ...readJSON<Partial<Settings>>(KEY, {}) };
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  writeJSON(KEY, current);
  listeners.forEach((fn) => fn());
}

export function subscribeSettings(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 是否该播放动画：用户设置 + 系统偏好 */
export function motionEnabled(): boolean {
  if (current.motion === 'reduced') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
