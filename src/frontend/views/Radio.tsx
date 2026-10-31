import { useEffect, useMemo, useState } from 'react';
import { music, type Track } from '../api';
import { Cover } from '../components/Cover';
import { Equalizer } from '../components/Equalizer';
import { Icon } from '../components/Icon';
import { useColumns } from '../components/Rail';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { BPM_RANGE, fromResource, PACES, sportMix } from '../lib/radio';
import { readJSON, writeJSON } from '../lib/storage';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';
import { currentTrack, playerStore, playList } from '../player/player';

const BPM_KEY = 'qwq-sport-bpm';
/** 声音墙一次多放几行 */
const SOUND_ROWS = 3;

/** 跑步漫游：选步频，按节拍挑一张歌单 */
function SportRadio() {
  const [bpm, setBpm] = useState(() => {
    const v = readJSON<number>(BPM_KEY, 140);
    return Number.isFinite(v) ? Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, v)) : 140;
  });
  const [busy, setBusy] = useState(false);
  const [mix, setMix] = useState<{ bpm: number; tracks: Track[] } | null>(null);
  useEffect(() => writeJSON(BPM_KEY, bpm), [bpm]);
  const pace = PACES.reduce((a, b) => (Math.abs(b.bpm - bpm) < Math.abs(a.bpm - bpm) ? b : a));

  const start = async () => {
    setBusy(true);
    try {
      const tracks = await sportMix(bpm);
      if (!tracks.length) return toast('这个步频暂时没挑到歌，换一档试试。');
      setMix({ bpm, tracks });
      playList(tracks);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section radio-section">
      <div className="sport reveal">
        <div className="sport-dial" style={{ '--bpm': bpm } as React.CSSProperties} aria-hidden="true">
          <span className="sport-ring" />
          <span className="sport-ring" />
          <span className="sport-num">{bpm}</span>
          <span className="sport-unit mono">BPM · {pace.label}</span>
        </div>
        <div className="sport-side">
          <div className="kicker">跑步漫游</div>
          <h2 className="sport-title">跟着步子放歌</h2>
          <p className="muted">每分钟迈几步，就挑每分钟几拍的歌。选个配速，节奏相近的歌会连成一张歌单。</p>
          <div className="pace-chips" role="radiogroup" aria-label="配速">
            {PACES.map((p) => (
              <button key={p.bpm} role="radio" aria-checked={bpm === p.bpm} className={bpm === p.bpm ? 'on' : ''} onClick={() => setBpm(p.bpm)}>
                {p.label}
                <span className="mono">{p.bpm}</span>
              </button>
            ))}
          </div>
          <label className="sport-range">
            <span className="sr-only">步频</span>
            <input type="range" min={BPM_RANGE.min} max={BPM_RANGE.max} step={BPM_RANGE.step} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
            <span className="mono faint">
              {BPM_RANGE.min}–{BPM_RANGE.max}
            </span>
          </label>
          <button className="btn solid" onClick={() => void start()} disabled={busy}>
            <Icon name="play" /> {busy ? '正在挑歌…' : `按 ${bpm} 步频开跑`}
          </button>
        </div>
      </div>

      {mix && (
        <div className="sport-mix">
          <div className="section-head s-head">
            <h2>{mix.bpm} BPM 附近的 {mix.tracks.length} 首</h2>
          </div>
          <TrackList tracks={mix.tracks} covers showAlbum={false} />
        </div>
      )}
    </section>
  );
}

/** 静心：助眠、冥想、白噪音……按分类排成一面声音墙 */
function SatiRadio() {
  const [tag, setTag] = useState<string | undefined>();
  const [rows, setRows] = useState(SOUND_ROWS);
  const grid = useColumns();
  const { data, error, loading, reload } = useAsync(() => music.sati(tag), [tag], `sati:${tag ?? ''}`);
  const current = useStore(playerStore, (s) => currentTrack(s)?.id);
  const playing = useStore(playerStore, (s) => s.playing);
  useEffect(() => setRows(SOUND_ROWS), [tag]);

  const names = useMemo(() => new Map((data?.tags ?? []).map((t) => [t.id, t.name])), [data]);
  const active = tag ?? data?.tags[0]?.id;
  const tracks = useMemo(
    () => (data?.resources ?? []).filter((r) => r.trackId).map((r) => fromResource(r, names.get(r.tag ?? '') ?? names.get(active ?? '') ?? '')),
    [data, names, active],
  );
  // 只露整行：没放完时截到列数的整数倍
  const step = Math.max(grid.cols, 1);
  const shown = tracks.length > step * rows ? step * rows : tracks.length;

  return (
    <section className="section radio-section">
      <div className="section-head s-head reveal">
        <h2>静心</h2>
        <span className="mono faint s-count">助眠 · 冥想 · 白噪音</span>
        {tracks.length > 0 && (
          <div className="s-head-side">
            <button className="btn sm" onClick={() => playList(tracks)}>
              <Icon name="play" /> 全部播放
            </button>
          </div>
        )}
      </div>

      {data && data.tags.length > 0 && (
        <div className="sati-tags" role="tablist" aria-label="分类">
          {data.tags.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? 'on' : ''} onClick={() => setTag(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {loading && <Loading rows={4} />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && !tracks.length && !loading && <p className="muted">这个分类暂时没有声音。</p>}

      <div className="sounds" ref={grid.ref}>
        {tracks.slice(0, shown).map((t, i) => {
          const on = t.id === current;
          return (
            <button key={t.id} className={`sound reveal ${on ? 'current' : ''}`} style={{ '--i': i % (step * SOUND_ROWS) } as React.CSSProperties} onClick={() => playList(tracks, i)}>
              <span className="sound-art">
                <Cover src={t.coverUrl} alt="" size={300} />
                <span className="sound-play" aria-hidden="true">
                  {on ? <Equalizer playing={playing} /> : <Icon name="play" />}
                </span>
              </span>
              <span className="sound-title">{t.name}</span>
              <span className="sound-tag mono">{t.artists[0]?.name}</span>
            </button>
          );
        })}
      </div>
      {tracks.length > shown && (
        <button className="btn s-all" onClick={() => setRows((n) => n + SOUND_ROWS)}>
          再多一些 <span className="mono faint">{tracks.length - shown}</span>
        </button>
      )}
    </section>
  );
}

export function RadioView() {
  return (
    <div className="page radio">
      <header className="page-head reveal">
        <div className="kicker">场景电台</div>
        <h1 className="page-title">电台</h1>
      </header>
      <SportRadio />
      <SatiRadio />
    </div>
  );
}
