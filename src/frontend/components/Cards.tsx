import { useRef } from 'react';
import type { ArtistSearchItem, DiscoverItem, Playlist } from '../api';
import { resolveDiscover } from '../lib/discover';
import { heroStore, markHero, setPreview } from '../lib/motion';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { playTrackById } from '../player/player';
import { Cover } from './Cover';
import { Vinyl } from './Vinyl';

interface CardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  coverUrl?: string;
  /** 艺人用圆形头像，不带唱片 */
  round?: boolean;
  /** 'playlist:123'，用于封面飞行过渡 */
  heroKey?: string;
  to?: string;
  onActivate?: () => void;
  /** 入场动画的序号 */
  index?: number;
  className?: string;
}

/** 唱片封套卡片：封套后面藏着一张黑胶，悬停时滑出来 */
export function Card({ title, subtitle, meta, coverUrl, round, heroKey, to, onActivate, index = 0, className = '' }: CardProps) {
  const coverRef = useRef<HTMLDivElement>(null);
  const activeHero = useStore(heroStore, (s) => s.key);
  const isHero = !!heroKey && heroKey === activeHero;

  const onClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (heroKey) {
      markHero(coverRef.current, heroKey);
      setPreview(heroKey, { title, coverUrl, subtitle });
    }
    if (onActivate) {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <a
      className={`card reveal ${round ? 'card-round' : ''} ${className}`}
      style={{ '--i': index } as React.CSSProperties}
      href={to ?? '#'}
      onClick={onClick}
    >
      <div className="sleeve-wrap">
        {!round && <Vinyl cover={coverUrl} className="card-vinyl" labelPx={120} />}
        <Cover ref={coverRef} src={coverUrl} alt="" className={`sleeve ${round ? 'round' : ''} ${isHero ? 'hero-active' : ''}`} />
      </div>
      <div className="card-text">
        {meta && <div className="card-meta mono">{meta}</div>}
        <div className="card-title">{title}</div>
        {subtitle && <div className="card-desc">{subtitle}</div>}
      </div>
    </a>
  );
}

const no = (i: number) => String(i + 1).padStart(2, '0');

export function DiscoverCard({ item, index }: { item: DiscoverItem; index: number }) {
  const action = resolveDiscover(item);
  return (
    <Card
      index={index}
      title={item.title}
      subtitle={item.subtitle}
      meta={no(index)}
      coverUrl={item.coverUrl}
      round={item.type === 'artist'}
      heroKey={action.kind === 'link' ? action.heroKey : undefined}
      to={action.kind === 'link' ? action.to : action.kind === 'external' ? action.url : undefined}
      onActivate={discoverActivate(action)}
    />
  );
}

/** 不是站内链接的条目（直接播放 / 外链 / 无动作）点击时怎么处理 */
export function discoverActivate(action: ReturnType<typeof resolveDiscover>) {
  switch (action.kind) {
    case 'play':
      return () => void playTrackById(action.trackId);
    case 'external':
      return () => void window.open(action.url, '_blank', 'noopener');
    case 'none':
      return () => undefined;
    default:
      return undefined;
  }
}

export function PlaylistCard({ p, index }: { p: Playlist; index: number }) {
  return (
    <Card
      index={index}
      title={p.name}
      subtitle={p.description}
      meta={p.tracks?.length ? `${p.tracks.length} 首` : '歌单'}
      coverUrl={p.coverUrl}
      heroKey={`playlist:${p.id}`}
      to={href.playlist(p.id)}
    />
  );
}

export function ArtistCard({ a, index }: { a: ArtistSearchItem; index: number }) {
  return (
    <Card
      index={index}
      title={a.name}
      meta={a.musicSize ? `${a.musicSize} 首歌` : '艺人'}
      coverUrl={a.coverUrl}
      round
      heroKey={`artist:${a.id}`}
      to={href.artist(a.id)}
    />
  );
}
