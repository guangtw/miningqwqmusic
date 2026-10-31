import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { coverOf, hasId } from '../api';
import { activeLineIndex, displayLines, isUnsynced } from '../lib/lrc';
import { tweenScroll, useFrame } from '../lib/motion';
import { tintVars, useTint } from '../lib/palette';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { audioTime, currentTrack, playerStore, seek } from '../player/player';
import { uiStore } from '../player/ui';
import { Icon } from './Icon';
import { toggleNowPlaying } from './PlayerBar';
import { Turntable } from './Turntable';

/** 歌词提前一点点亮，唱到时刚好在中间 */
const LEAD_MS = 220;

export function NowPlaying() {
  const open = useStore(uiStore, (s) => s.nowPlaying);
  const track = useStore(playerStore, (s) => currentTrack(s));
  const index = useStore(playerStore, (s) => s.index);
  const total = useStore(playerStore, (s) => s.queue.length);
  const playing = useStore(playerStore, (s) => s.playing);
  const lyric = useStore(playerStore, (s) => s.lyric);
  const position = useStore(playerStore, (s) => s.position);
  const tint = useTint(track ? coverOf(track) : undefined);

  const lines = useMemo(() => displayLines(lyric), [lyric]);
  const unsynced = isUnsynced(lines);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);
  const cancelTween = useRef<() => void>(() => undefined);

  // 每帧算当前行，只有换行时才触发渲染
  useFrame(() => {
    if (unsynced || !lines.length) return;
    const i = activeLineIndex(lines, (playing ? audioTime() : position) + LEAD_MS);
    setActive((prev) => (prev === i ? prev : i));
  }, open && playing);

  useEffect(() => {
    if (!open || !playing) setActive(unsynced ? -1 : activeLineIndex(lines, position + LEAD_MS));
  }, [open, playing, position, lines, unsynced]);

  // 当前行滚到歌词框 42% 处（遮罩渐隐区之下、视觉中心略偏上）；用户刚手动滚过的话先不抢。
  // 刚打开面板或刚换歌时直接定位，不从顶部滚下来
  const placedFor = useRef<string | null>(null);
  useEffect(() => {
    const box = listRef.current;
    if (!open) placedFor.current = null;
    if (!open || !box || active < 0 || Date.now() - userScrolledAt.current < 2500) return;
    const el = box.children[active] as HTMLElement | undefined;
    if (!el) return;
    const to = el.offsetTop - box.clientHeight * 0.42 + el.offsetHeight / 2;
    cancelTween.current();
    if (placedFor.current !== lyric?.trackId) {
      placedFor.current = lyric?.trackId ?? null;
      box.scrollTop = to;
    } else cancelTween.current = tweenScroll(box, to, 700);
  }, [active, open, lyric]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && toggleNowPlaying(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!track && open) uiStore.set({ nowPlaying: false });
  }, [track, open]);

  const close = () => toggleNowPlaying(false);

  return (
    <section
      className={`nowplaying ${open ? 'open' : ''}`}
      aria-label="正在播放"
      aria-hidden={!open}
      // React 18 的类型里还没有 inert，按原生属性传
      {...(open ? {} : ({ inert: '' } as Record<string, string>))}
      style={tintVars(tint)}
    >
      <div className="np-glow" aria-hidden="true">
        <i />
        <i />
      </div>
      <header className="np-head">
        <span className="mono">
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        <button className="btn ghost" onClick={close}>
          收起 <Icon name="down" />
        </button>
      </header>

      {track && (
        <div className="np-body">
          <div className="np-deck-col">
            <Turntable vtName={open ? 'np-disc' : undefined} />
          </div>

          <div className="np-info-col">
            <div className="np-titles">
              <h2 className="np-name" key={track.id}>
                {track.name}
              </h2>
              <p className="np-by">
                {track.artists.map((a, i) => (
                  <Fragment key={`${a.id}-${i}`}>
                    {i > 0 && ' / '}
                    {hasId(a.id) ? (
                      <a href={href.artist(a.id)} onClick={close}>
                        {a.name}
                      </a>
                    ) : (
                      a.name
                    )}
                  </Fragment>
                ))}
                {hasId(track.album?.id) && (
                  <>
                    <span className="faint"> · </span>
                    <a href={href.album(track.album!.id)} onClick={close}>
                      {track.album.name}
                    </a>
                  </>
                )}
              </p>
            </div>

            {lines.length ? (
              <div
                ref={listRef}
                className={`lyrics ${unsynced ? 'unsynced' : ''}`}
                onWheel={() => {
                  userScrolledAt.current = Date.now();
                  cancelTween.current();
                }}
                onTouchMove={() => {
                  userScrolledAt.current = Date.now();
                  cancelTween.current();
                }}
              >
                {lines.map((l, i) => (
                  <button
                    key={i}
                    className={`lyric-line ${i === active ? 'active' : ''} ${i < active ? 'past' : ''}`}
                    style={{ '--d': active < 0 ? 3 : Math.min(5, Math.abs(i - active)) } as React.CSSProperties}
                    onClick={() => {
                      if (unsynced) return;
                      userScrolledAt.current = 0;
                      seek(l.timeMs);
                    }}
                  >
                    <span>{l.text}</span>
                    {l.translation && <small>{l.translation}</small>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="lyrics-empty">{lyric ? '纯音乐，安静听。' : '正在找歌词…'}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
