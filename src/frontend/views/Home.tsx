import { useEffect, useState } from 'react';
import { music, type DiscoverBlock, type DiscoverItem } from '../api';
import { Card, DiscoverCard, discoverActivate } from '../components/Cards';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { ErrorState, Loading } from '../components/States';
import { Vinyl } from '../components/Vinyl';
import { epigraph as epigraphCfg, homeLayout, site, type BlockLayout } from '../config/site';
import { resolveDiscover } from '../lib/discover';
import { cachedEpigraph, todaysEpigraph, type Epigraph } from '../lib/epigraph';
import { dayKey, formatTime } from '../lib/format';
import { markHero, setPreview } from '../lib/motion';
import { tintVars, useTint } from '../lib/palette';
import { href, navigate } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { playList, playTrack } from '../player/player';

function layoutOf(block: DiscoverBlock): BlockLayout {
  const byId = homeLayout.byBlockId[block.id];
  if (byId) return byId;
  const counts = new Map<string, number>();
  for (const it of block.items) counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as DiscoverItem['type'] | undefined;
  return (top && homeLayout.byItemType[top]) || 'grid';
}

function pickFeature(blocks: DiscoverBlock[]): DiscoverItem | undefined {
  const preferred = blocks.find((b) => b.id === homeLayout.featureBlockId);
  const fallback = blocks.find((b) => layoutOf(b) === 'grid' && b.items.some((i) => resolveDiscover(i).kind === 'link'));
  return (preferred ?? fallback)?.items.find((i) => resolveDiscover(i).kind === 'link');
}

function SectionHead({ no, title }: { no: number; title: string }) {
  return (
    <div className="section-head reveal">
      <span className="section-no">{String(no).padStart(2, '0')}</span>
      <h2>{title}</h2>
    </div>
  );
}

/** 封面故事：大封套 + 慢慢滑出的唱片 */
function Feature({ item }: { item: DiscoverItem }) {
  const action = resolveDiscover(item);
  const tint = useTint(item.coverUrl);
  if (action.kind !== 'link') return null;

  const open = (e: React.MouseEvent) => {
    const cover = (e.currentTarget.closest('.feature') as HTMLElement).querySelector<HTMLElement>('.feature-art .sleeve');
    markHero(cover, action.heroKey);
    setPreview(action.heroKey, { title: item.title, coverUrl: item.coverUrl, subtitle: item.subtitle });
  };

  const playAll = async () => {
    if (!item.targetId) return;
    const p = item.type === 'toplist' ? await music.toplist(item.targetId) : await music.playlist(item.targetId);
    playList(p.tracks);
  };

  return (
    <article className={`feature ${tint ? 'tinted' : ''}`} style={tintVars(tint)}>
      <a className="feature-art" href={action.to} onClick={open} aria-label={item.title}>
        <Vinyl cover={item.coverUrl} className="feature-vinyl" labelPx={300} spinning />
        <Cover src={item.coverUrl} alt="" size={800} className="sleeve" />
      </a>
      <div className="feature-text">
        <div className="kicker">封面故事</div>
        <h1 className="feature-title">{item.title}</h1>
        {item.subtitle && <p className="feature-sub">{item.subtitle}</p>}
        <div className="actions">
          <button className="btn solid" onClick={() => void playAll()}>
            <Icon name="play" /> 放上唱机
          </button>
          <a className="btn ghost" href={action.to} onClick={open}>
            翻开 <Icon name="arrow" />
          </a>
        </div>
      </div>
    </article>
  );
}

function BannerStrip({ items }: { items: DiscoverItem[] }) {
  return (
    <div className="banner-strip">
      {items.map((it, i) => {
        const action = resolveDiscover(it);
        const onActivate = discoverActivate(action);
        return (
          <a
            key={it.id}
            className={`banner reveal ${action.kind === 'none' ? 'inert' : ''}`}
            style={{ '--i': i } as React.CSSProperties}
            href={action.kind === 'link' ? action.to : action.kind === 'external' ? action.url : '#'}
            onClick={(e) => {
              if (onActivate) {
                e.preventDefault();
                onActivate();
              }
            }}
          >
            <Cover src={it.coverUrl} alt="" size={800} />
            <span className="banner-cap">
              <span className="mono">{it.subtitle}</span>
              <b>{it.title}</b>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function ChartList({ items }: { items: DiscoverItem[] }) {
  return (
    <ol className="chart-list">
      {items.map((it, i) => {
        const action = resolveDiscover(it);
        const act = discoverActivate(action);
        return (
          <li key={it.id} className="reveal" style={{ '--i': i } as React.CSSProperties}>
            <a
              href={action.kind === 'link' ? action.to : '#'}
              onClick={(e) => {
                if (act) {
                  e.preventDefault();
                  return act();
                }
                if (action.kind === 'link') {
                  markHero(e.currentTarget.querySelector<HTMLElement>('.cover'), action.heroKey);
                  setPreview(action.heroKey, { title: it.title, coverUrl: it.coverUrl });
                }
              }}
            >
              <span className="chart-no">{String(i + 1).padStart(2, '0')}</span>
              <Cover src={it.coverUrl} alt="" size={120} />
              <span className="chart-text">
                <b>{it.title}</b>
                {it.subtitle && <span className="muted">{it.subtitle}</span>}
              </span>
              <Icon name="arrow" />
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function Block({ block, no, skip }: { block: DiscoverBlock; no: number; skip?: string }) {
  const layout = layoutOf(block);
  const items = block.items.filter((i) => i.id !== skip).slice(0, homeLayout.limits[layout]);
  if (!items.length) return null;
  return (
    <section className={`section section-${layout}`}>
      <SectionHead no={no} title={block.title} />
      {layout === 'banner' && <BannerStrip items={items} />}
      {layout === 'chart' && <ChartList items={items} />}
      {(layout === 'grid' || layout === 'list') && (
        <div className="grid-cards">
          {items.map((it, i) => (
            <DiscoverCard key={it.id} item={it} index={i} />
          ))}
        </div>
      )}
      {layout === 'shelf' && (
        <div className="shelf">
          {items.map((it, i) => (
            <DiscoverCard key={it.id} item={it} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}

/** 把一句话拆成逐个浮现的小块：中文按字，英文按词（避免单词被拆到两行） */
function tokens(text: string) {
  return text.match(/[A-Za-z0-9'’\-]+|\s+|./gu) ?? [];
}

/**
 * 页眉：一条细栏，不和下面的封面故事抢主角。
 * 左边是今日卷首语那句歌词在歌里出现的时刻（At 0:32），旁边是这句歌词和出处。
 * 点时刻或出处都从这一刻开始播放。同一天固定，第二天自动换。
 */
function EpigraphHead({ source, ready }: { source?: DiscoverItem; ready: boolean }) {
  // undefined = 还在挑；null = 没挑到，用兜底句
  const [ep, setEp] = useState<Epigraph | null | undefined>(() => cachedEpigraph() ?? undefined);
  useEffect(() => {
    if (ep !== undefined || !ready) return;
    let alive = true;
    todaysEpigraph(source).then(
      (e) => alive && setEp(e),
      () => alive && setEp(null),
    );
    return () => {
      alive = false;
    };
  }, [ready, source?.targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = ep === undefined;
  const now = new Date();
  // 大数字：歌词时刻；没时间轴或没挑到句子时退回今天的日期
  const [mark, figure] =
    ep && ep.timeMs != null ? ['At', formatTime(ep.timeMs)] : ['On', `${now.getMonth() + 1}.${now.getDate()}`];
  const text = loading ? '' : (ep?.text ?? epigraphCfg.fallback);
  const play = () => ep && playTrack(ep.track, ep.timeMs != null ? Math.max(0, ep.timeMs - epigraphCfg.playLeadMs) : undefined);
  let c = 0;

  return (
    <>
      <button
        className={`mast-figure ${loading ? 'is-loading' : ''}`}
        onClick={play}
        disabled={!ep}
        aria-label={ep ? `从 ${figure} 开始播放《${ep.track.name}》` : undefined}
        title={ep ? '从这一刻开始听' : undefined}
      >
        <span className="mast-mark mono">{mark}</span>
        {/* 挑句子期间用一个看不见的占位撑住大小，句子出来时版面不跳 */}
        {loading ? (
          <span className="mast-digits">0:00</span>
        ) : (
          <span className="mast-digits" key={figure}>
            {Array.from(figure).map((d, i) => (
              <span key={i} className="mast-d" style={{ '--c': i } as React.CSSProperties}>
                {d}
              </span>
            ))}
          </span>
        )}
      </button>

      <figure className={`epigraph ${loading ? 'is-loading' : ''}`}>
        <div className="epigraph-line">
          <blockquote className="epigraph-text" aria-label={text} lang={/\p{Script=Han}/u.test(text) ? undefined : 'en'}>
            {text && (
              <span aria-hidden="true">
                {tokens(text).map((t, i) =>
                  /^\s+$/.test(t) ? (
                    t
                  ) : (
                    <span key={i} className="ch" style={{ '--c': c++ } as React.CSSProperties}>
                      {t}
                    </span>
                  ),
                )}
              </span>
            )}
          </blockquote>
          {ep?.translation && <span className="epigraph-tr">{ep.translation}</span>}
        </div>
        <figcaption className="epigraph-meta">
          <span className="epigraph-label mono">{epigraphCfg.label}</span>
          {ep && (
            <button className="epigraph-src" style={{ '--c': c } as React.CSSProperties} onClick={play}>
              《{ep.track.name}》<span className="faint">{ep.track.artists.map((a) => a.name).join(' / ')}</span>
              <Icon name="arrow" />
            </button>
          )}
        </figcaption>
      </figure>
    </>
  );
}

export function Home() {
  const { data, error, loading, reload } = useAsync(() => music.discoverHome(), [], 'discover');
  const feature = data && pickFeature(data.blocks);
  const kw = data?.searchAssist.defaultKeyword;

  return (
    <div className="page home">
      <header className="masthead reveal">
        <EpigraphHead source={feature} ready={!loading} />
        <div className="masthead-meta">
          {kw && (
            <a className="masthead-ask" href={href.search(kw)}>
              今天想听「{kw}」吗 <Icon name="arrow" />
            </a>
          )}
        </div>
      </header>

      {loading && <Loading rows={8} />}
      {error && <ErrorState error={error} onRetry={reload} />}

      {data && (
        <>
          {feature && <Feature item={feature} />}
          {data.blocks.map((b, i) => (
            <Block key={b.id} block={b} no={i + 1} skip={feature?.id} />
          ))}
          {!data.blocks.length && (
            <section className="section">
              <p className="muted">后端暂时没有推荐内容。去搜索看看？</p>
              <Card title="搜索" to={href.search()} onActivate={() => navigate(href.search())} />
            </section>
          )}
          <footer className="colophon mono">
            <span>
              {site.name} · {dayKey().replace(/-/g, '.')}
            </span>
            <span>{site.footerNote}</span>
          </footer>
        </>
      )}
    </div>
  );
}
