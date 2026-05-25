export function nextVolumeAfterMuteToggle(currentVolume: number, previousVolume: number, fallback = 0.8) {
  if (currentVolume <= 0) {
    return {
      volume: previousVolume > 0 ? previousVolume : fallback,
      previousVolume
    };
  }
  return {
    volume: 0,
    previousVolume: currentVolume
  };
}

export function heroActionLabel(hasTrack: boolean, isPlaying: boolean): string {
  if (!hasTrack) return "去搜索";
  return isPlaying ? "暂停播放" : "开始播放";
}

type TrackLike = { id: string };

type SpaceHotkeyArgs = {
  key: string;
  code?: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

export function countUniqueLibraryTracks(
  favorites: Record<string, TrackLike>,
  recentTracks: TrackLike[]
): number {
  const ids = new Set<string>();
  Object.values(favorites).forEach((track) => {
    if (track?.id) ids.add(track.id);
  });
  recentTracks.forEach((track) => {
    if (track?.id) ids.add(track.id);
  });
  return ids.size;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return Boolean(target.closest('[contenteditable=""], [contenteditable="true"]'));
}

export function shouldTogglePlaybackBySpace(args: SpaceHotkeyArgs): boolean {
  const isSpace = args.key === " " || args.code === "Space";
  if (!isSpace) return false;
  if (args.repeat) return false;
  if (args.ctrlKey || args.metaKey || args.altKey || args.shiftKey) return false;
  if (isEditableKeyboardTarget(args.target)) return false;
  return true;
}
