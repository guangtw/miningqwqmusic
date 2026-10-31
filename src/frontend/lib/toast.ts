import { createStore } from './store';

export const toastStore = createStore<{ message: string | null; key: number }>({ message: null, key: 0 });

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string) {
  clearTimeout(timer);
  toastStore.set((s) => ({ message, key: s.key + 1 }));
  timer = setTimeout(() => toastStore.set({ message: null }), 3200);
}
