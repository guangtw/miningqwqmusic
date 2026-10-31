import { coverOf } from '../api';
import { libraryStore, toggleFavorite } from '../lib/account';
import { artistNames } from '../lib/format';
import { transition } from '../lib/motion';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { currentTrack, cycleMode, MODE_LABEL, next, playerStore, prev, setVolume, toggle, toggleMute } from '../player/player';
import { uiStore } from '../player/ui';
import { HeartButton } from './HeartButton';
import { Icon } from './Icon';
import { SeekBar } from './SeekBar';
import { Slider } from './Slider';
import { Vinyl } from './Vinyl';

export function toggleNowPlaying(open = !uiStore.get().nowPlaying) {
  if (open && !currentTrack()) return;
  transition(() => uiStore.set({ nowPlaying: open, queue: false }), open ? 'np-open' : 'np-close');
}

export function PlayerBar() {
  const track = useStore(playerStore, (s) => currentTrack(s));
  const playing = useStore(playerStore, (s) => s.playing);
  const loading = useStore(playerStore, (s) => s.loading);
  const volume = useStore(playerStore, (s) => s.volume);
  const muted = useStore(playerStore, (s) => s.muted);
  const mode = useStore(playerStore, (s) => s.mode);
  const queueLen = useStore(playerStore, (s) => s.queue.length);
  const liked = useStore(libraryStore, (s) => (track ? track.id in s.favorites : false));
  const npOpen = useStore(uiStore, (s) => s.nowPlaying);
  const qOpen = useStore(uiStore, (s) => s.queue);

  return (
    <footer className="player" aria-label="播放控制">
      <SeekBar compact />
      <div className="np">
        {track ? (
          // key 变化时整块重新挂载，触发换歌的滑入动画
          <div className="np-swap" key={track.id}>
            <button onClick={() => toggleNowPlaying()} aria-label="打开正在播放" style={{ flex: 'none' }}>
              <Vinyl
                cover={coverOf(track)}
                spinning={playing}
                className="mini-vinyl"
                labelPx={96}
                ref={(el) => {
                  // 正在播放页打开时，这张小唱片「飞」成唱机上的大唱片
                  if (el) el.style.viewTransitionName = npOpen ? '' : 'np-disc';
                }}
              />
            </button>
            <div className="np-text" onClick={() => toggleNowPlaying()}>
              <div className="np-title">{track.name}</div>
              <div className="np-artist">{artistNames(track.artists)}</div>
            </div>
            <HeartButton className="hide-sm" liked={liked} onToggle={() => toggleFavorite(track)} />
          </div>
        ) : (
          <div className="np-text">
            <div className="np-title faint">唱机空着</div>
            <div className="np-artist">
              挑一张
              <a className="link" href={href.home()} style={{ textDecoration: 'underline' }}>
                唱片
              </a>
              放上去
            </div>
          </div>
        )}
      </div>

      <div className="transport">
        <div className="transport-btns">
          <button className="icon-btn hide-sm" onClick={cycleMode} aria-label={MODE_LABEL[mode]} title={MODE_LABEL[mode]}>
            <span className="swap-icon" key={mode}>
              <Icon name={mode} />
            </span>
          </button>
          <button className="icon-btn nudge-left hide-sm" onClick={prev} aria-label="上一首">
            <Icon name="prev" />
          </button>
          <button
            className={`play-btn ${playing ? 'is-playing' : ''} ${loading ? 'is-loading' : ''}`}
            onClick={toggle}
            aria-label={playing ? '暂停' : '播放'}
          >
            <span className="pp pp-play">
              <Icon name="play" />
            </span>
            <span className="pp pp-pause">
              <Icon name="pause" />
            </span>
            <span className="spinner" aria-hidden="true" />
          </button>
          <button className="icon-btn nudge-right" onClick={() => next()} aria-label="下一首">
            <Icon name="next" />
          </button>
          <button
            className={`icon-btn hide-sm ${npOpen ? 'on' : ''}`}
            onClick={() => toggleNowPlaying()}
            aria-label="歌词"
            title="歌词（L）"
          >
            <Icon name="lyrics" />
          </button>
        </div>
        <SeekBar />
      </div>

      <div className="tools">
        <button className="icon-btn" onClick={toggleMute} aria-label={muted ? '取消静音' : '静音'}>
          <Icon name={muted || volume === 0 ? 'mute' : 'volume'} />
        </button>
        <Slider
          className="volume"
          value={muted ? 0 : volume}
          max={1}
          onCommit={setVolume}
          onInput={setVolume}
          label="音量"
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <button
          className={`icon-btn ${qOpen ? 'on' : ''}`}
          onClick={() => uiStore.set({ queue: !qOpen })}
          aria-label="播放队列"
          title={`播放队列（${queueLen}）`}
          style={{ marginLeft: 8 }}
        >
          <Icon name="queue" />
          {queueLen > 0 && <span className="badge mono">{queueLen}</span>}
        </button>
      </div>
    </footer>
  );
}
