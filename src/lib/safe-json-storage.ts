"use client";

import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";

export function createSafeJSONStorage<S>(getStorage: () => StateStorage): PersistStorage<S> | undefined {
  try {
    const storage = getStorage();

    return {
      getItem: async (name) => {
        const raw = await storage.getItem(name);
        if (!raw) return null;

        try {
          return JSON.parse(raw) as StorageValue<S>;
        } catch {
          await storage.removeItem(name);
          return null;
        }
      },
      setItem: (name, value) => storage.setItem(name, JSON.stringify(value)),
      removeItem: (name) => storage.removeItem(name)
    };
  } catch {
    return undefined;
  }
}
