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
