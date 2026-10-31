import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { music, type PlayQualityLevel, type TrackQualityAvailability } from '../api';
import { qualities } from '../config/site';
import { authStore } from '../lib/account';
import { usePresence } from '../lib/motion';
import { getSettings, subscribeSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { currentTrack, playerStore, setQuality } from '../player/player';
import { QualityMark } from './QualityMark';
import { QualityPicker } from './QualityPicker';

const optionOf = (k: PlayQualityLevel) => qualities.find((q) => q.key === k) ?? qualities[0];
const PANEL_W = 368;

/**
 * 播放台上的音质标签 + 弹出的音质面板。
 * 标签显示后端实际给的音质，高音质直接用对应标识。
 * 面板挂到 body 上：播放台本身是毛玻璃，嵌在里面的玻璃只能模糊播放台自己，透不到后面的页面。
 */
export function QualityMenu() {
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, 200);
  const chosen = useSyncExternalStore(subscribeSettings, () => getSettings().quality, () => getSettings().quality);
  const level = useStore(playerStore, (s) => s.level);
  const track = useStore(playerStore, (s) => currentTrack(s));
  const [avail, setAvail] = useState<TrackQualityAvailability | null>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number; origin: number } | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 打开时问一次这首歌有哪些音质
  useEffect(() => {
    if (!open || !track || avail?.trackId === track.id) return;
    let alive = true;
    music.qualityOptions(track.id, authStore.get().token).then(
      (r) => alive && setAvail(r),
      () => alive && setAvail(null),
    );
    return () => {
      alive = false;
    };
  }, [open, track, avail]);

  // 面板对准标签的正上方，贴着窗口边时往里收
  const place = useCallback(() => {
    const r = chipRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(PANEL_W, window.innerWidth - 24);
    const cx = r.left + r.width / 2;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, cx - width / 2));
    setPos({ left, bottom: window.innerHeight - r.top + 14, width, origin: cx - left });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // 点外面、按 Esc、换页时收起；窗口变化时重新对位
  useEffect(() => {
    if (!open) return;
    const inside = (n: Node) => chipRef.current?.contains(n) || panelRef.current?.contains(n);
    const onDown = (e: PointerEvent) => !inside(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', close);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', close);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const shown = optionOf(level ?? chosen);
  const forTrack = avail && track && avail.trackId === track.id ? avail : null;
  const downgraded = !!level && level !== chosen;

  return (
    <div className="quality">
      <button
        ref={chipRef}
        className={`q-chip ${shown.mark ? `has-mark kind-${shown.mark.kind}` : ''} ${open ? 'on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`音质：${shown.label}`}
        title="音质"
      >
        <span className="swap-icon" key={shown.key}>
          <QualityMark option={shown} withLabel={shown.mark?.kind === 'sq' || shown.mark?.kind === 'spatial'} />
        </span>
      </button>

      {mounted &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="q-panel"
            role="dialog"
            aria-label="音质"
            data-state={state}
            style={{ left: pos.left, bottom: pos.bottom, width: pos.width, '--origin': `${pos.origin}px` } as React.CSSProperties}
          >
            <header className="q-panel-head">
              <h3>音质</h3>
              {track && (
                <span className="q-now">
                  正在播放 <QualityMark option={shown} />
                </span>
              )}
            </header>
            <QualityPicker
              value={chosen}
              onPick={(k) => setQuality(k)}
              available={forTrack?.availableLevels ?? null}
              fallback={forTrack?.fallbackMap ?? null}
            />
            <p className="q-foot">
              {downgraded
                ? `你选的是「${optionOf(chosen).label}」，账号权限或音源不够，这首实际是「${shown.label}」。`
                : '账号权限或音源不够时，后端会自动降到可用的最高一档。'}
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
