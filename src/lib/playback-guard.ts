type SessionSnapshot = {
  sessionId: number;
  trackId: string | null;
  token: number;
};

type PlaybackStartArgs = {
  isPlaying: boolean;
  sourceChanged: boolean;
  audioPaused: boolean;
};

type RecoveryGateArgs = {
  inFlight: boolean;
  now: number;
  lastRecoverAt: number;
  cooldownMs: number;
};

export function shouldReloadTrack(prevTrackId: string | null, nextTrackId: string | null): boolean {
  return prevTrackId !== nextTrackId;
}

export function isSessionValid(
  snapshot: SessionSnapshot,
  currentSessionId: number,
  currentTrackId: string | null,
  currentToken: number
): boolean {
  return (
    snapshot.sessionId === currentSessionId &&
    snapshot.trackId === currentTrackId &&
    snapshot.token === currentToken
  );
}

export function shouldStartPlayback(args: PlaybackStartArgs): boolean {
  if (!args.isPlaying) return false;
  return args.sourceChanged || args.audioPaused;
}

export function canStartRecovery(args: RecoveryGateArgs): boolean {
  if (args.inFlight) return false;
  return args.now - args.lastRecoverAt >= args.cooldownMs;
}
