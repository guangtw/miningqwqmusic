import { currentTrack, playerStore } from '../player/player';
import { api } from '../config/site';
import { authed, authStore } from './account';
import { artistNames } from './format';

const HEARTBEAT_MS = 30_000;

function playingTrack() {
  const state = playerStore.get();
  return state.playing && !state.loading ? currentTrack(state) : null;
}

function reportTab() {
  const clientId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let inFlight = false;
  let pending = false;
  let previousTrack = playingTrack();

  async function send() {
    if (controller.signal.aborted) return;
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    pending = false;
    const track = playingTrack();
    const name = track?.name.trim().slice(0, 256);
    const body = { clientId, track: track && name ? { name, artist: artistNames(track.artists).slice(0, 256) } : null };
    try {
      await authed(api.paths.presence, { method: 'POST', body, signal: controller.signal });
    } catch {
      // The next heartbeat retries; presence never interrupts playback.
    } finally {
      inFlight = false;
      if (pending) void send();
    }
  }

  const unsubscribe = playerStore.subscribe(() => {
    const track = playingTrack();
    if (track === previousTrack) return;
    previousTrack = track;
    clearTimeout(timer);
    timer = setTimeout(() => void send(), 250);
  });
  const interval = setInterval(() => void send(), HEARTBEAT_MS);
  const onVisible = () => { if (!document.hidden) void send(); };
  const onOnline = () => void send();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  void send();

  return () => {
    controller.abort();
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  };
}

export function watchPresence() {
  let userId: string | undefined;
  let stop: (() => void) | undefined;
  const sync = () => {
    const auth = authStore.get();
    const nextUserId = auth.status === 'authenticated' ? auth.user?.id : undefined;
    if (userId === nextUserId) return;
    userId = nextUserId;
    stop?.();
    stop = userId ? reportTab() : undefined;
  };
  const unsubscribe = authStore.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    stop?.();
  };
}
