"use client";

import dynamic from "next/dynamic";
import { migrateStorage } from "./lib/migrate-storage";

if (typeof window !== 'undefined') {
  try { migrateStorage(window.localStorage); } catch { /* Private browsing may block storage. */ }
}

// The upstream SPA owns browser-only audio, hash navigation and local storage.
// Next.js continues to serve the same-origin BFF.
const App = dynamic(() => import("./App").then((module) => module.App), { ssr: false });

export function RecordStore() {
  return <div id="root"><App /></div>;
}
