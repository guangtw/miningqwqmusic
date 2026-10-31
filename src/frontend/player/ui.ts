import { createStore } from '../lib/store';

/** 浮层开关：正在播放页、队列抽屉、登录框 */
export const uiStore = createStore({ nowPlaying: false, queue: false, login: false });
