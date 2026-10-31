import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { music, type PlayQualityLevel } from '../api';
import { qualities } from '../config/site';
import { authStore } from '../lib/account';
import { usePresence } from '../lib/motion';
import { getSettings, subscribeSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { currentTrack, playerStore, setQuality } from '../player/player';

const labelOf = (k: PlayQualityLevel) => qualities.find((q) => q.key === k)?.label ?? k;
/** 无损及以上算「高音质」，标签用强调色 */
const HIGH: PlayQualityLevel[] = ['lossless', 'hires', 'jymaster', 'dolby', 'sky'];

/**
 * 播放台上的音质标签：显示正在播放的实际音质，点开从上方弹出音质列表。
 * 打开时向后端问一次这首歌有哪些音质，没有的置灰；切换后从当前位置接着放。
 */
export function QualityMenu() {
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, 180);
  const chosen = useSyncExternalStore(subscribeSettings, () => getSettings().quality);
  const level = useStore(playerStore, (s) => s.level);
  const track = useStore(playerStore, (s) => currentTrack(s));
  const [avail, setAvail] = useState<{ id: string; levels: PlayQualityLevel[] } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !track || avail?.id === track.id) return;
    let alive = true;
    music.qualityOptions(track.id, authStore.get().token).then(
      (r) => alive && setAvail({ id: track.id, levels: r.availableLevels }),
      () => alive && setAvail(null),
    );
    return () => {
      alive = false;
    };
  }, [open, track, avail]);

  // 点外面或按 Esc 收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = level ?? chosen;
  const levels = avail && track && avail.id === track.id ? avail.levels : null;
  const downgraded = !!level && level !== chosen;

  return (
    <div className="quality" ref={boxRef}>
      <button
        className={`q-chip ${HIGH.includes(shown) ? 'high' : ''} ${open ? 'on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`音质：${labelOf(shown)}`}
        title="音质"
      >
        <span className="swap-icon" key={shown}>
          {labelOf(shown)}
        </span>
      </button>
      {mounted && (
        <div className="q-menu" role="menu" data-state={state}>
          <div className="q-head mono">音质</div>
          {qualities.map((q) => {
            const missing = !!levels && !levels.includes(q.key);
            return (
              <button
                key={q.key}
                role="menuitemradio"
                aria-checked={q.key === chosen}
                className={`q-item ${q.key === chosen ? 'on' : ''}`}
                disabled={missing}
                onClick={() => {
                  setQuality(q.key);
                  setOpen(false);
                }}
              >
                <span>{q.label}</span>
                {missing && <span className="q-note">这首没有</span>}
              </button>
            );
          })}
          {downgraded && <p className="q-hint">当前实际是「{labelOf(level!)}」，账号权限不够时会自动降一档。</p>}
        </div>
      )}
    </div>
  );
}
