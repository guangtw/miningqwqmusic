import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coverOf, hasId } from '../api';
import { libraryStore, toggleFavorite } from '../lib/account';
import { dropLayer, hasLayer, popLayer, pushLayer } from '../lib/backstack';
import { downloadTrack } from '../lib/download';
import { formatTime } from '../lib/format';
import { useInsight } from '../lib/insight';
import { activeLineIndex, displayLines, isUnsynced } from '../lib/lrc';
import { tweenScroll, useFrame, useMedia } from '../lib/motion';
import { tintVars, useTint } from '../lib/palette';
import { href, navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { audioTime, currentTrack, playerStore, seek, toggle } from '../player/player';
import { openTrackMenu, uiStore } from '../player/ui';
import { HeartButton } from './HeartButton';
import { Icon } from './Icon';
import { LinerNotes } from './LinerNotes';
import { toggleNowPlaying } from './PlayerBar';
import { PopMenu } from './PopMenu';
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
  const liked = useStore(libraryStore, (s) => (track ? track.id in s.favorites : false));
  // 歌词 / 唱片内页二选一；百科只在面板打开时去问
  const [view, setView] = useState<'lyrics' | 'notes'>('lyrics');
  const insight = useInsight(track?.id, open);
  const chorus = insight.data?.chorusStartMs;
  const fromChorus = () => {
    if (chorus == null) return;
    seek(chorus);
    if (!playing) toggle();
    setView('lyrics');
  };
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeMore = useCallback(() => setMore(false), []);

  // 手机上：平时唱机 + 歌名下面只露两行歌词，点唱机或歌词进「全屏歌词」，别的都收起来。
  // 全屏歌词也占一条历史记录，系统返回先退回唱机
  const narrow = useMedia('(max-width: 860px)');
  const [focus, setFocus] = useState(false);
  const focusLayer = useRef(0);
  // 刚从全屏歌词退回来：唱机和歌名浮上来一下
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    if (!returning) return;
    const t = setTimeout(() => setReturning(false), 600);
    return () => clearTimeout(t);
  }, [returning]);
  const leaveFocus = () => {
    setFocus(false);
    setReturning(true);
  };
  const enterFocus = () => {
    if (focus) return;
    setView('lyrics');
    setFocus(true);
    focusLayer.current = pushLayer(leaveFocus);
  };
  const exitFocus = () => {
    if (hasLayer(focusLayer.current)) popLayer(focusLayer.current);
    else leaveFocus();
  };
  useEffect(() => {
    if (open) return;
    dropLayer(focusLayer.current);
    setFocus(false);
  }, [open]);
  const peek = narrow && !focus;

  const lines = useMemo(() => displayLines(lyric), [lyric]);
  const unsynced = isUnsynced(lines);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // 收起时整个面板不可聚焦、不可点。直接设 DOM 属性：React 18 的类型里没有 inert，
  // React 19 又把 inert="" 当成 false，两边都靠不住
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = !open;
  }, [open]);
  const userScrolledAt = useRef(0);
  // 点了一句还没唱到的歌词：先在句尾亮出一个小播放键，再点它才跳过去，免得误触就跳
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => {
    if (armed == null) return;
    const t = setTimeout(() => setArmed(null), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => setArmed(null), [lyric, open, focus]);
  const tapLine = (i: number) => {
    // 手机上只露两行时，点歌词是展开成全屏
    if (peek) return enterFocus();
    // 全屏歌词里点正在唱的那句（或纯文本歌词的任意一句）：回到唱机
    if (i === active || unsynced) {
      setArmed(null);
      if (focus) exitFocus();
      return;
    }
    setArmed(armed === i ? null : i);
  };
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

  // 当前行滚到歌词框 42% 处（遮罩渐隐区之下、视觉中心略偏上）；手机上只露两行时顶在第一行。
  // 用户刚手动滚过的话先不抢。刚打开面板、刚换歌、刚切换全屏时直接定位，不从顶部滚下来
  const placedFor = useRef<string | null>(null);
  useEffect(() => {
    placedFor.current = null;
  }, [peek]);
  useEffect(() => {
    const box = listRef.current;
    // 面板收起或切到唱片内页后，再回到歌词时直接定位到当前行
    if (!open || view !== 'lyrics') placedFor.current = null;
    if (!open || !box || active < 0 || Date.now() - userScrolledAt.current < 2500) return;
    const el = box.children[active] as HTMLElement | undefined;
    if (!el) return;
    const to = peek ? el.offsetTop : el.offsetTop - box.clientHeight * 0.42 + el.offsetHeight / 2;
    cancelTween.current();
    const key = `${lyric?.trackId}:${peek}`;
    if (placedFor.current !== key) {
      placedFor.current = key;
      box.scrollTop = to;
    } else cancelTween.current = tweenScroll(box, to, peek ? 520 : 700);
  }, [active, open, lyric, view, peek]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || uiStore.get().menu || more) return;
      if (focus) exitFocus();
      else toggleNowPlaying(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, focus, more]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!track && open) uiStore.set({ nowPlaying: false });
  }, [track, open]);

  const close = () => toggleNowPlaying(false);
  // 面板里的歌手 / 专辑链接：先退掉面板那条历史记录，再跳过去，返回时不会回到一条空记录上
  const go = (e: React.MouseEvent, to: string) => {
    e.preventDefault();
    toggleNowPlaying(false, () => navigate(to));
  };

  return (
    <section
      className={`nowplaying ${open ? 'open' : ''} ${focus ? 'np-focus' : ''} ${returning ? 'np-return' : ''}`}
      aria-label="正在播放"
      aria-hidden={!open}
      ref={panelRef}
      style={tintVars(tint)}
    >
      <div className="np-glow" aria-hidden="true">
        <i />
        <i />
      </div>
      <header className="np-head">
        {focus && track ? (
          <button className="np-mini" onClick={exitFocus} aria-label="回到唱机">
            <Icon name="disc" size={18} />
            <span className="np-mini-name">{track.name}</span>
            <span className="np-mini-by">{track.artists.map((a) => a.name).join(' / ')}</span>
          </button>
        ) : (
          <span className="mono">
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        )}
        <button className="btn ghost" onClick={close}>
          收起 <Icon name="down" />
        </button>
      </header>

      {track && (
        <div className="np-body">
          <div
            className="np-deck-col"
            onClick={(e) => {
              // 手机上点唱机进全屏歌词；拖唱臂不算
              if (narrow && !(e.target as Element).closest('.arm-head')) enterFocus();
            }}
          >
            <Turntable vtName={open ? 'np-disc' : undefined} active={open && !(narrow && focus)} />
          </div>

          <div className="np-info-col">
            <div className="np-titles">
              <div className="np-name-row">
                <h2 className="np-name" key={track.id}>
                  {track.name}
                </h2>
                <HeartButton className="show-sm" liked={liked} onToggle={() => toggleFavorite(track)} />
              </div>
              <p className="np-by">
                {track.artists.map((a, i) => (
                  <Fragment key={`${a.id}-${i}`}>
                    {i > 0 && ' / '}
                    {hasId(a.id) ? (
                      <a href={href.artist(a.id)} onClick={(e) => go(e, href.artist(a.id))}>
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
                    <a href={href.album(track.album!.id)} onClick={(e) => go(e, href.album(track.album!.id))}>
                      {track.album.name}
                    </a>
                  </>
                )}
              </p>
              <div className="np-actions">
                <button className="np-chip" onClick={(e) => openTrackMenu(e, [track], { addOnly: true })} aria-haspopup="menu">
                  <Icon name="listAdd" size={16} /> 加到歌单
                </button>
                <button className={`np-chip ${view === 'notes' ? 'on' : ''}`} aria-pressed={view === 'notes'} onClick={() => setView(view === 'notes' ? 'lyrics' : 'notes')}>
                  <Icon name="notes" size={16} /> 唱片内页
                </button>
                <button ref={moreRef} className={`np-chip np-more ${more ? 'on' : ''}`} onClick={() => setMore(!more)} aria-haspopup="menu" aria-expanded={more} aria-label="更多">
                  <Icon name="more" size={16} />
                </button>
                <PopMenu anchor={moreRef} open={more} onClose={closeMore} label="更多操作">
                  <button
                    role="menuitem"
                    className="t-menu-item"
                    onClick={() => {
                      void downloadTrack(track);
                      closeMore();
                    }}
                  >
                    <Icon name="download" /> 下载
                  </button>
                  <button
                    role="menuitem"
                    className="t-menu-item"
                    disabled={chorus == null}
                    onClick={() => {
                      fromChorus();
                      closeMore();
                    }}
                  >
                    <Icon name="chorus" /> 从副歌听
                    <span className="t-menu-side mono">{chorus != null ? formatTime(chorus) : insight.loading ? '…' : '无'}</span>
                  </button>
                  <button
                    role="menuitem"
                    className="t-menu-item"
                    onClick={() => {
                      uiStore.set({ listen: true, queue: false });
                      closeMore();
                    }}
                  >
                    <Icon name="people" /> 一起听
                  </button>
                </PopMenu>
              </div>
            </div>

            {view === 'notes' ? (
              <LinerNotes track={track} insight={insight.data} loading={insight.loading} onChorus={fromChorus} />
            ) : lines.length ? (
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
                  <div
                    key={i}
                    role="button"
                    tabIndex={0}
                    className={`lyric-line ${i === active ? 'active' : ''} ${i < active ? 'past' : ''} ${i === armed ? 'armed' : ''}`}
                    style={{ '--d': active < 0 ? 3 : Math.min(5, Math.abs(i - active)) } as React.CSSProperties}
                    onClick={() => tapLine(i)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      if (unsynced) return;
                      userScrolledAt.current = 0;
                      seek(l.timeMs);
                    }}
                  >
                    <span>{l.text}</span>
                    {i === armed && (
                      <button
                        className="lyric-go"
                        aria-label={`从这句开始放（${formatTime(l.timeMs)}）`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setArmed(null);
                          userScrolledAt.current = 0;
                          seek(l.timeMs);
                          if (!playing) toggle();
                        }}
                      >
                        <Icon name="play" size={14} />
                      </button>
                    )}
                    {l.translation && <small>{l.translation}</small>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="lyrics-empty" onClick={() => peek && enterFocus()}>
                {lyric ? '纯音乐，安静听。' : '正在找歌词…'}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
