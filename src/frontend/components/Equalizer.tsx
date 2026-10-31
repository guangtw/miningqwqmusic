/** 正在播放的跳动小柱；暂停时柱子平滑落下而不是定格 */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={`eq ${playing ? '' : 'paused'}`} aria-label={playing ? '正在播放' : '已暂停'}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
