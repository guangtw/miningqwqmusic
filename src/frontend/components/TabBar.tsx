import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { nav } from '../config/site';
import { useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { currentTrack, playerStore } from '../player/player';
import { Icon, type IconName } from './Icon';

// 手机底栏（#12 #13），照 Apple Music 的样子，整条底栏只有一个胶囊和一个圆：
// - 平时：左边胶囊放五个页面（搜索在最后），右边的圆是正在转的那张小唱片（迷你播放台缩成的），点它打开唱机
// - 往下翻页：两者左右换个个儿——胶囊缩成左边一颗只剩当前页图标的圆，右边的圆展开成完整的迷你播放台
// - 放上一首新歌时也换过去，马上看得到在放什么、能暂停
// - 往回翻、翻回顶部、换页、或者点左边那颗圆：换回来
// 没在放歌时右边没有圆，胶囊占满一整行，也不收起。
// 状态写在 <html data-dock="min"> 上，播放台的位置和形状由 CSS 跟着它走（refresh.css）。
// 宽屏不显示（左侧栏照旧）。左右滑动切页按胶囊里的顺序走：本期 → 榜单 → 电台 → 唱片架 → 搜索

const TABS: { key: string; icon: IconName }[] = [
  { key: '', icon: 'disc' },
  { key: 'charts', icon: 'chart' },
  { key: 'radio', icon: 'radio' },
  { key: 'library', icon: 'shelf' },
  { key: 'search', icon: 'search' },
];
const SECTION_ALIAS: Record<string, string> = { mine: 'library' };
const NARROW = '(max-width: 860px)';
/** 往一个方向连续翻过这么多像素才收起 / 展开，免得手指一抖就来回变 */
const TRAVEL = 36;

/** 最近待过的那一页：进了歌单、专辑这些详情页，底栏仍然亮着来时那一项（收起时圆钮也显示它） */
let lastTab = '';

export function TabBar() {
  const route = useRoute();
  const section = SECTION_ALIAS[route.parts[0] ?? ''] ?? route.parts[0] ?? '';
  const isTab = TABS.some((t) => t.key === section);
  if (isTab) lastTab = section;
  // 亮着的那一项：一级页面就是它自己；详情页沿用来时那一项
  const current = isTab ? section : lastTab;
  const trackId = useStore(playerStore, (s) => currentTrack(s)?.id ?? null);
  const hasTrack = trackId != null;
  const [folded, setMin] = useState(false);
  // 没在放歌：右边没有播放台可展开，不收
  const min = folded && hasTrack;

  // 跟着主内容区的滚动方向收起 / 展开
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.main');
    if (!main) return;
    const narrow = window.matchMedia(NARROW);
    let last = main.scrollTop;
    let travel = 0;
    const onScroll = () => {
      const y = main.scrollTop;
      const dy = y - last;
      last = y;
      if (!narrow.matches) return;
      if (y < 24) {
        travel = 0;
        setMin(false);
        return;
      }
      travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
      if (travel > TRAVEL) setMin(true);
      else if (travel < -TRAVEL) setMin(false);
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setMin(false), [route.path]);

  // 放上一首新歌：底栏换到播放台那一边，马上看得到在放什么、能暂停。
  // 刚打开网站时恢复的上次那首不算（那不是此刻点的）
  const seenTrack = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const first = seenTrack.current === undefined;
    const changed = seenTrack.current !== trackId;
    seenTrack.current = trackId;
    if (!first && changed && trackId != null && window.matchMedia(NARROW).matches) setMin(true);
  }, [trackId]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (min) root.dataset.dock = 'min';
    else delete root.dataset.dock;
  }, [min]);

  const curIndex = TABS.findIndex((t) => t.key === current);

  return (
    <nav className={`dock ${min ? 'min' : ''} ${hasTrack ? '' : 'solo'}`} aria-label="主导航" data-swipe-tabs>
      {/* 胶囊的各层都不改尺寸，收展只靠平移（refresh.css 第 1 节）：
          玻璃整条平移、外面套一层固定的圆角裁剪；阴影一段固定在左端、一段跟着玻璃走；
          左端被裁掉的那段描边由一段固定的半圆补上 */}
      <div
        className="dock-pill"
        style={{ '--dock-tab-count': TABS.length, '--dock-lens-x': `${curIndex * 100}%` } as CSSProperties}
        onClickCapture={(e) => {
          // 收起时整颗圆钮就是「展开」：不跳页
          if (!min) return;
          e.preventDefault();
          e.stopPropagation();
          setMin(false);
        }}
      >
        <Shade />
        <span className="dock-skin" aria-hidden="true">
          <i className="dock-skin-fill" />
        </span>
        <span className="dock-skin-cap" aria-hidden="true" />
        <div className="dock-tabs">
          <span className="dock-lens" aria-hidden="true" />
          {TABS.map((t, i) => {
            const n = nav.find((x) => x.key === t.key)!;
            const rel = i === curIndex ? 'cur' : i < curIndex ? 'pre' : 'post';
            return (
              <a
                key={t.key}
                href={n.to}
                data-key={t.key || 'home'}
                className={`${section === t.key ? 'on' : ''} ${rel}`}
                style={{ '--i': i } as CSSProperties}
                aria-current={section === t.key ? 'page' : undefined}
                aria-label={min && i === curIndex ? `${n.label}（展开导航）` : undefined}
              >
                <Icon name={t.icon} />
                <span className="dock-label">{n.label}</span>
              </a>
            );
          })}
        </div>
      </div>
      {/* 迷你播放台的阴影：播放台自己裁成圆角（玻璃在里面平移），阴影放不进去，画在这里 */}
      {hasTrack && <Shade player />}
    </nav>
  );
}

/** 一个形状的阴影：端头一颗固定的圆 + 一段跟着玻璃平移的长条，在圆心处各裁一半拼起来 */
function Shade({ player = false }: { player?: boolean }) {
  return (
    <span className={`dock-shade ${player ? 'dock-shade-player' : ''}`} aria-hidden="true">
      <i className="dock-shade-cap" />
      <i className="dock-shade-clip">
        <i className="dock-shade-run" />
      </i>
    </span>
  );
}
