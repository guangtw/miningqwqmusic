import { useEffect, useMemo, useRef, useState } from 'react';
import { coverOf } from '../api';
import { libraryStore, toggleFavorite } from '../lib/account';
import { useBakedArt } from '../lib/bakedArt';
import { beatIndexAt, beatMapOf, type BeatMap } from '../lib/beats';
import { activeLineIndex, displayLines, isUnsynced, lineProgress, splitCredits } from '../lib/lrc';
import { useMedia } from '../lib/motion';
import { tintVars, useTint } from '../lib/palette';
import { motionEnabled, updateSettings } from '../lib/settings';
import { RecordStage } from '../lib/stage';
import { useStore } from '../lib/store';
import { audioSource, audioTime, currentTrack, next, playerStore, prev, toggle } from '../player/player';
import { uiStore } from '../player/ui';
import { sized } from './Cover';
import { HeartButton } from './HeartButton';
import { Icon } from './Icon';
import { toggleNowPlaying } from './PlayerBar';
import { SeekBar } from './SeekBar';

/** 歌词提前一点点亮，和普通页一致 */
const LEAD_MS = 220;
/** 控件闲置多久后隐去 */
const IDLE_MS = 2800;
/** 底鼓包络的衰减时间常数（秒） */
const KICK_TAU = 0.17;

/**
 * 沉浸舞台：正在播放页的默认样子。
 * 画面全在 lib/stage.ts 的一张 WebGL 画布里；这里管歌词、控件和节拍。
 * 歌词进度、节拍、画面都挂在同一条 rAF 上，React 只在换句时渲染。
 */
export function Immersive({ open }: { open: boolean }) {
  const track = useStore(playerStore, (s) => currentTrack(s));
  const index = useStore(playerStore, (s) => s.index);
  const total = useStore(playerStore, (s) => s.queue.length);
  const playing = useStore(playerStore, (s) => s.playing);
  const loading = useStore(playerStore, (s) => s.loading);
  const lyric = useStore(playerStore, (s) => s.lyric);
  const liked = useStore(libraryStore, (s) => (track ? track.id in s.favorites : false));
  const narrow = useMedia('(max-width: 860px)');
  const tint = useTint(track ? coverOf(track) : undefined);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<RecordStage | null>(null);
  const [glFailed, setGlFailed] = useState(false);
  const curRef = useRef<HTMLDivElement>(null);

  const { lines } = useMemo(() => splitCredits(displayLines(lyric)), [lyric]);
  const unsynced = isUnsynced(lines);
  const [active, setActive] = useState(-1);
  // 退场的那一句单独留一会儿，演完往上飘走
  const [leaving, setLeaving] = useState<{ key: number; text: string } | null>(null);

  // ---- 舞台 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = RecordStage.create(canvas, { phone: narrow, still: !motionEnabled() });
    if (!stage) {
      setGlFailed(true);
      return;
    }
    stage.onLost = () => setGlFailed(true);
    stageRef.current = stage;
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __stage?: RecordStage }).__stage = stage;
    const ro = new ResizeObserver(() => stage.resize());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      stage.destroy();
      stageRef.current = null;
    };
  }, [narrow]);

  useEffect(() => {
    if (open) stageRef.current?.intro();
  }, [open]);

  const coverUrl = track ? sized(coverOf(track), 300) : undefined;
  useEffect(() => {
    stageRef.current?.setCover(coverUrl);
  }, [coverUrl, glFailed, narrow]);

  // ---- 节拍表：放到这首、地址就绪后另取一份分析；取不到就用歌词换句当鼓点 ----
  const beats = useRef<{ id: string; map: BeatMap | null }>({ id: '', map: null });
  useEffect(() => {
    if (!open || !track || loading) return;
    if (beats.current.id === track.id) return;
    const ctl = new AbortController();
    const id = track.id;
    beats.current = { id, map: null };
    beatMapOf(id, audioSource(), ctl.signal).then((map) => {
      if (beats.current.id === id) beats.current = { id, map };
      document.documentElement.dataset.beat = map ? 'kick' : 'lyric';
    });
    return () => ctl.abort();
  }, [open, track?.id, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // 被取消的话下次进来重新取
    if (!open) beats.current = { id: '', map: null };
  }, [open]);

  // ---- 一条 rAF：节拍包络 → 舞台；当前句 → 逐字点亮 ----
  const live = useRef({ lines, unsynced, active: -1, playing });
  live.current.lines = lines;
  live.current.unsynced = unsynced;
  live.current.playing = playing;
  useEffect(() => {
    if (!open) return;
    let id = 0;
    let last = performance.now();
    let lastT = -1;
    let beatIdx = 0;
    let kick = 0;
    let lastPulse = -1e9;
    const loop = (now: number) => {
      id = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      // 换歌加载中 <audio> 还停在上一首的时间上，按新歌的 0 算
      const ps = playerStore.get();
      const t = L.playing && !ps.loading ? audioTime() : ps.position;
      const map = beats.current.map;
      const jumped = lastT < 0 || t < lastT - 60 || t > lastT + 1200;
      kick *= Math.exp(-dt / KICK_TAU);
      if (map) {
        if (jumped) beatIdx = beatIndexAt(map, t);
        while (beatIdx < map.times.length && map.times[beatIdx] <= t) {
          const s = map.strength[beatIdx++];
          if (!L.playing) continue;
          kick = Math.max(kick, s);
          if (s > 0.55 && t - lastPulse > 300) {
            lastPulse = t;
            stageRef.current?.pulse(0.55 + s * 0.45);
          }
        }
      }
      lastT = t;

      if (!L.unsynced && L.lines.length) {
        const i = activeLineIndex(L.lines, t + LEAD_MS);
        if (i !== L.active) {
          const prevActive = L.active;
          L.active = i;
          setActive(i);
          if (prevActive >= 0 && L.lines[prevActive] && !jumped) setLeaving({ key: prevActive, text: L.lines[prevActive].text });
          // 没有节拍表时，换句就是这首歌的「鼓点」
          if (!map && L.playing && !jumped && i >= 0) {
            kick = Math.max(kick, 0.75);
            stageRef.current?.pulse(0.85);
          }
        }
        curRef.current?.style.setProperty('--p', `${(lineProgress(L.lines, i, t + LEAD_MS) * 100).toFixed(1)}%`);
      }
      stageRef.current?.frame(kick, L.playing);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    live.current.active = -1;
    setLeaving(null);
  }, [lyric]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), 900);
    return () => clearTimeout(t);
  }, [leaving]);

  // ---- 控件：动一下鼠标出现，闲置后隐去；触屏上点一下切换 ----
  const [ui, setUi] = useState(true);
  const idle = useRef(0);
  const wake = () => {
    setUi(true);
    clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setUi(false), IDLE_MS);
  };
  useEffect(() => {
    if (open) wake();
    return () => clearTimeout(idle.current);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // 暂停时控件一直留着
  useEffect(() => {
    if (!playing) {
      clearTimeout(idle.current);
      setUi(true);
    } else if (open) wake();
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    stageRef.current?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    wake();
  };
  const onStageTap = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if (ui) {
      clearTimeout(idle.current);
      setUi(false);
    } else wake();
  };

  const toClassic = () => updateSettings({ npMode: 'classic' });
  const baked = useBakedArt(track ? sized(coverOf(track), 160) : undefined);

  if (!track) return null;
  const cur = active >= 0 ? lines[active] : null;
  const upcoming = active + 1 < lines.length ? lines[active + 1] : null;
  const showTitle = !lines.length || unsynced;
  const side = `SIDE ${String.fromCharCode(65 + Math.floor(index / 6) % 26)} · ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

  return (
    <div
      className={`immersive ${ui ? 'ui' : ''} ${glFailed ? 'no-gl' : ''}`}
      style={tintVars(tint)}
      onPointerMove={onPointerMove}
      // 点在控件上时续一下；点空白处由 .im-hit 自己切换显隐（这里也唤醒的话，抬手时读到的已经是「显示」，又给藏回去了）
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).classList.contains('im-hit')) wake();
      }}
    >
      <canvas ref={canvasRef} className="im-gl" aria-hidden="true" />
      {glFailed && baked && <div className="im-fallback" style={{ backgroundImage: `url("${baked}")` }} aria-hidden="true" />}
      <div className="im-hit" onPointerUp={onStageTap} aria-hidden="true" />

      <header className="im-top">
        <button className="im-btn" onClick={() => toggleNowPlaying(false)} aria-label="收起">
          <Icon name="down" size={20} />
        </button>
        <span className="im-side mono">{side}</span>
        <button className="im-mode" onClick={toClassic} title="切换到普通唱机页">
          <Icon name="disc" size={16} />
          <span>普通</span>
        </button>
      </header>

      <div className="im-lyrics" aria-live="off">
        {showTitle ? (
          <div className="im-line im-title-line" key={`t-${track.id}`}>
            <span className="im-text">{track.name}</span>
            <small>{lyric ? (unsynced ? '这首歌的歌词没有时间轴' : '纯音乐，安静听') : '正在找歌词…'}</small>
          </div>
        ) : (
          <>
            {leaving && (
              <div className="im-line out" key={`o-${leaving.key}`} aria-hidden="true">
                <span className="im-text">{leaving.text}</span>
              </div>
            )}
            {cur && (
              <div className="im-line cur" key={`c-${active}`} ref={curRef}>
                <span className="im-text" data-text={cur.text}>
                  {cur.text}
                </span>
                {cur.translation && <small>{cur.translation}</small>}
              </div>
            )}
            {!cur && <div className="im-line cur im-prelude" key="pre"><span className="im-text">{track.name}</span></div>}
            {upcoming && (
              <div className="im-next" key={`n-${active + 1}`}>
                {upcoming.text}
              </div>
            )}
          </>
        )}
      </div>

      <footer className="im-bottom">
        <div className="im-meta">
          <div className="im-name">{track.name}</div>
          <div className="im-by">
            {track.artists.map((a) => a.name).join(' / ')}
            {track.album?.name && <span className="im-album"> · {track.album.name}</span>}
          </div>
        </div>
        <div className="im-transport">
          <button className="im-btn" onClick={() => prev()} aria-label="上一首">
            <Icon name="prev" size={22} />
          </button>
          <button className="im-play" onClick={() => toggle()} aria-label={playing ? '暂停' : '播放'}>
            <Icon name={playing ? 'pause' : 'play'} size={26} />
          </button>
          <button className="im-btn" onClick={() => next()} aria-label="下一首">
            <Icon name="next" size={22} />
          </button>
        </div>
        <div className="im-tools">
          <HeartButton className="im-btn" liked={liked} onToggle={() => toggleFavorite(track)} />
          <button className="im-btn" onClick={() => uiStore.set({ queue: !uiStore.get().queue, listen: false })} aria-label="播放队列">
            <Icon name="queue" size={20} />
          </button>
        </div>
        <div className="im-seek">
          <SeekBar />
        </div>
      </footer>
    </div>
  );
}
