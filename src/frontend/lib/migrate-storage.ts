import type { Track } from '../api/types';

function tracks(value: unknown): Track[] {
  if (!Array.isArray(value)) return [];
  return value.filter((track): track is Track => !!track && typeof track.id === 'string' &&
    typeof track.name === 'string' && Array.isArray(track.artists) && Number.isFinite(track.durationMs));
}

/** Copy the previous site's device data once. Never overwrite the new site's data. */
export function migrateStorage(storage: Storage) {
  try {
    const previous = JSON.parse(storage.getItem('qwq-music-store-v1') || 'null')?.state;
    if (!previous || typeof previous !== 'object') return;
    if (!storage.getItem('cph.library')) {
      const favorites = Object.fromEntries(tracks(Object.values(previous.favorites || {})).map((t) => [t.id, t]));
      storage.setItem('cph.library', JSON.stringify({ favorites, favoriteOrder: Object.keys(favorites),
        recent: tracks(previous.recent), importedPlaylists: previous.importedPlaylists || {}, revision: 0 }));
    }
    if (!storage.getItem('cph.player.v2')) {
      const queue = tracks(previous.queue);
      const index = Number.isInteger(previous.currentIndex) ? previous.currentIndex : -1;
      storage.setItem('cph.player.v2', JSON.stringify({ queue, index: index >= 0 && index < queue.length ? index : -1,
        volume: Number.isFinite(previous.volume) ? Math.max(0, Math.min(1, previous.volume)) : 0.8,
        mode: previous.mode === 'loop-one' ? 'one' : previous.mode === 'shuffle' ? 'shuffle' : 'loop' }));
    }
    if (!storage.getItem('cph.settings.v2')) {
      const theme = storage.getItem('mqm-theme');
      storage.setItem('cph.settings.v2', JSON.stringify({ theme: theme === 'dark' ? 'night' : theme === 'light' ? 'paper' : 'auto',
        ...(typeof previous.playQualityLevel === 'string' ? { quality: previous.playQualityLevel } : {}) }));
    }
  } catch { /* A blocked or corrupt device store must not stop the site from loading. */ }
}
