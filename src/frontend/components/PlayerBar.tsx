import { coverOf } from '../api';
import { libraryStore, toggleFavorite } from '../lib/account';
import { artistNames } from '../lib/format';
import { dropLayer, hasLayer, popLayer, pushLayer } from '../lib/backstack';
import { snap, transition } from '../lib/motion';
import { motionEnabled } from '../lib/settings';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { currentTrack, cycleMode, MODE_LABEL, next, playerStore, prev, setVolume, swapDirection, toggle, toggleMute } from '../player/player';
import { uiStore } from '../player/ui';
import { listenStore } from '../lib/listen';
import { HeartButton } from './HeartButton';
import { Icon } from './Icon';
import { QualityMenu } from './QualityMenu';
import { SeekBar } from './SeekBar';
import { SourceRecovery } from './SourceRecovery';
import { Slider } from './Slider';
import { Vinyl } from './Vinyl';

let npLayer = 0;

/**
 * 开关正在播放页。打开时压一条历史记录，系统返回键 / 侧滑先把它收起来；
 * 界面里点收起也是退掉这条记录。then：收起之后再做（例如跳到歌手页）
 */
export function toggleNowPlaying(open = !uiStore.get().nowPlaying, then?: () => void) {
  if (open) {
    if (!currentTrack() || uiStore.get().nowPlaying) return;
    transition(() => uiStore.set({ nowPlaying: true, queue: false, listen: false }), 'np-open');
    npLayer = pushLayer(closeNowPlaying);
  } else if (hasLayer(npLayer)) popLayer(npLayer, then);
  else {
    closeNowPlaying(false);
    then?.();
  }
}

function closeNowPlaying(instant: boolean) {
  if (!uiStore.get().nowPlaying) return;
  const update = () => uiStore.set({ nowPlaying: false });
  if (instant) return snap(update);
  // 收起过渡里唱臂单独一层跟着面板往下沉，沉到播放台上沿就被裁掉，看起来是钻到了播放台后面
  // （motion.css 的 np-arm）。裁剪线和下沉距离要按这一刻的布局算
  const arm = document.querySelector('.nowplaying .tonearm')?.getBoundingClientRect();
  const bar = document.querySelector('.player')?.getBoundingClientRect();
  if (arm && bar) {
    const root = document.documentElement.style;
    root.setProperty('--arm-clip', `${Math.round(bar.top - arm.top)}px`);
    root.setProperty('--np-h', `${window.innerHeight}px`);
  }
  transition(update, 'np-close');
}

// 换页等别的途径关掉了面板：那条历史记录不再代表它。
// 只看「开 → 关」这一下：打开时面板状态要等视图过渡的回调才改，中间别的字段变化不能误判成关了
let npWasOpen = false;
uiStore.subscribe(() => {
  const open = uiStore.get().nowPlaying;
  if (npWasOpen && !open && hasLayer(npLayer)) dropLayer(npLayer);
  npWasOpen = open;
});

/**
 * 换歌的滑入：下一首从右边推进来，上一首从左边，小唱片多转半圈。
 * 用 WAAPI 在这块刚挂载时播一次，不写成 CSS 动画：手机上开唱机时这块是 display:none，
 * CSS 动画在它重新显示时会从头再播——关唱机时整块又偏 18px 滑一遍，iPhone 上飞回来的唱片对准的是动画起点，落地后错开
 */
const swapped = new WeakSet<Element>();
function swapIn(el: HTMLDivElement | null) {
  if (!el || swapped.has(el)) return;
  swapped.add(el);
  if (!motionEnabled()) return;
  const back = el.dataset.dir === '-1';
  const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)'; // --ease-out
  el.animate([{ opacity: 0, transform: `translateX(${back ? -18 : 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 550, easing: ease });
  el.querySelector('.mini-vinyl')?.animate([{ transform: `rotate(${back ? 150 : -150}deg) scale(0.8)` }, { transform: 'none' }], { duration: 700, easing: ease });
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
  const lOpen = useStore(uiStore, (s) => s.listen);
  const listeners = useStore(listenStore, (s) => s.room?.members.length ?? 0);

  return (
    <footer className={`player ${npOpen ? 'np-open' : ''} ${track ? '' : 'is-empty'}`} aria-label="播放控制">
      <SeekBar compact />
      <div className="np">
        {track ? (
          // key 变化时整块重新挂载，触发换歌的滑入动画：下一首从右边进来，上一首从左边
          <div className="np-swap" key={track.id} data-dir={swapDirection()} ref={swapIn}>
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
              <SourceRecovery variant="bar" />
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
          {/* 左右对称：一起听 · 播放模式 | 上一首 播放 下一首 | 音质 · 队列 */}
          <div className="t-side t-left">
            <button
              className={`icon-btn t-extra ${lOpen || listeners ? 'on' : ''}`}
              onClick={() => uiStore.set({ listen: !lOpen, queue: false })}
              aria-label="一起听"
              title={listeners ? `一起听（${listeners} 人）` : '一起听'}
            >
              <Icon name="people" />
              {listeners > 0 && <span className="badge mono">{listeners}</span>}
            </button>
            <button className="icon-btn t-mode" onClick={cycleMode} aria-label={MODE_LABEL[mode]} title={MODE_LABEL[mode]}>
              <span className="swap-icon" key={mode}>
                <Icon name={mode} />
              </span>
            </button>
          </div>
          <button className="icon-btn nudge-left t-prev" onClick={prev} aria-label="上一首">
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
          <div className="t-side t-right">
            <QualityMenu />
            <button
              className={`icon-btn t-extra ${qOpen ? 'on' : ''}`}
              onClick={() => uiStore.set({ queue: !qOpen, listen: false })}
              aria-label="播放队列"
              title={`播放队列（${queueLen}）`}
            >
              <Icon name="queue" />
              {queueLen > 0 && <span className="badge mono">{queueLen}</span>}
            </button>
          </div>
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
      </div>
    </footer>
  );
}
