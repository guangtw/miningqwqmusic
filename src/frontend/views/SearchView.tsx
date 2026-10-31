import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { music, type ArtistSearchItem, type PagedResult, type Playlist, type Track } from '../api';
import { ArtistCard, PlaylistCard } from '../components/Cards';
import { Cover } from '../components/Cover';
import { Highlight } from '../components/Highlight';
import { Icon } from '../components/Icon';
import { useRail } from '../components/Rail';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { api, searchTabs } from '../config/site';
import { markHero, setPreview } from '../lib/motion';
import { tintVars, useTint } from '../lib/palette';
import { href, navigate } from '../lib/router';
import { clearSearchHistory, forgetSearch, rememberSearch, searchHistoryStore } from '../lib/searchHistory';
import { useStore } from '../lib/store';
import { useAsync } from '../lib/useAsync';
import { playList } from '../player/player';

type TabKey = (typeof searchTabs)[number]['key'];

/** 综合页每类取几条 */
const OVERVIEW = { topTracks: 5, moreTracks: 10, cards: 12 };

interface Overview {
  tracks: PagedResult<Track>;
  artists: PagedResult<ArtistSearchItem>;
  playlists: PagedResult<Playlist>;
  /** 排第一的艺人热门歌里和搜索词同名的那首（搜歌名时上游单曲排序常常把原唱排得很靠后） */
  signature?: Track;
}

const emptyPage = <T,>(): PagedResult<T> => ({ items: [], page: 1, pageSize: 0, total: 0 });

/** 三类一起搜；某一类挂了不影响其他两类，全挂了才算失败 */
async function searchAll(q: string): Promise<Overview> {
  const artistsP = music.searchArtists(q, 1, OVERVIEW.cards);
  // 艺人结果一到就去翻头号艺人的热门歌，和单曲、歌单的搜索并行
  const signatureP = artistsP.then((r) => findSignature(q, r.items)).catch(() => undefined);
  const [tracks, artists, playlists] = await Promise.allSettled([
    music.searchTracks(q, 1),
    artistsP,
    music.searchPlaylists(q, 1, OVERVIEW.cards),
  ]);
  if (tracks.status === 'rejected' && artists.status === 'rejected' && playlists.status === 'rejected') throw tracks.reason;
  return {
    tracks: tracks.status === 'fulfilled' ? tracks.value : emptyPage(),
    artists: artists.status === 'fulfilled' ? artists.value : emptyPage(),
    playlists: playlists.status === 'fulfilled' ? playlists.value : emptyPage(),
    signature: await signatureP,
  };
}

/** 搜的是歌名（或「歌手 歌名」）时，从头号艺人的热门歌里找这首 */
async function findSignature(q: string, artists: ArtistSearchItem[]) {
  const lead = artists[0];
  if (!lead || bigArtist(q, artists)) return undefined;
  const n = norm(q);
  const rest = n.replace(norm(lead.name), '');
  const d = await music.artist(lead.id);
  return d.topTracks.find((t) => norm(t.name) === n || (!!rest && norm(t.name) === rest));
}

// ---------------- 最佳匹配 ----------------

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

type Best = { kind: 'artist'; artist: ArtistSearchItem } | { kind: 'track'; track: Track; index: number };

/**
 * 搜的就是这位歌手：艺人结果按热度排，排第一的那位和搜索词同名才算。
 * 排在后面的同名小号不算（搜「后来」第一位是刘若英，不该给一个叫后来的新人）。
 */
const bigArtist = (q: string, artists: ArtistSearchItem[]) => (artists[0] && norm(artists[0].name) === norm(q) ? artists[0] : undefined);

/**
 * 最佳匹配：排第一的同名歌手 → 头号艺人热门歌里的同名歌 → 单曲里的同名歌 → 第一首歌 → 第一位艺人。
 * 同名歌不在当前列表里时 index 为 -1，播放时单放这一首。
 */
function pickBest(q: string, o: Overview): Best | null {
  const n = norm(q);
  const artist = bigArtist(q, o.artists.items);
  if (artist) return { kind: 'artist', artist };
  if (o.signature) return { kind: 'track', track: o.signature, index: o.tracks.items.findIndex((t) => t.id === o.signature!.id) };
  const exact = o.tracks.items.findIndex((t) => norm(t.name) === n);
  const index = exact >= 0 ? exact : 0;
  if (o.tracks.items[index]) return { kind: 'track', track: o.tracks.items[index], index };
  return o.artists.items[0] ? { kind: 'artist', artist: o.artists.items[0] } : null;
}

function BestMatch({ best, tracks }: { best: Best; tracks: Track[] }) {
  const artist = best.kind === 'artist' ? best.artist : null;
  const track = best.kind === 'track' ? best.track : null;
  const cover = artist?.coverUrl ?? track?.coverUrl ?? track?.album?.coverUrl;
  const tint = useTint(cover);
  const [busy, setBusy] = useState(false);
  const heroKey = artist ? `artist:${artist.id}` : track?.album?.id ? `album:${track.album.id}` : undefined;
  const to = artist ? href.artist(artist.id) : track?.album?.id ? href.album(track.album.id) : undefined;

  const play = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (track) return best.kind === 'track' && best.index >= 0 ? playList(tracks, best.index) : playList([track]);
    if (!artist) return;
    setBusy(true);
    try {
      const d = await music.artist(artist.id);
      if (d.topTracks.length) playList(d.topTracks);
    } finally {
      setBusy(false);
    }
  };

  const open = (e: React.MouseEvent) => {
    if (!heroKey) return;
    markHero(e.currentTarget.querySelector<HTMLElement>('.best-art'), heroKey);
    setPreview(heroKey, { title: artist?.name ?? track?.album?.name ?? '', coverUrl: cover });
  };

  const meta = artist
    ? [artist.musicSize && `${artist.musicSize} 首歌`, artist.albumSize && `${artist.albumSize} 张专辑`].filter(Boolean).join(' · ')
    : [track!.artists.map((a) => a.name).join(' / '), track!.album?.name].filter(Boolean).join(' · ');

  return (
    <article className={`best ${tint ? 'tinted' : ''}`} style={tintVars(tint)}>
      <a className="best-link" href={to ?? '#'} onClick={to ? open : (e) => void play(e)}>
        <Cover src={cover} alt="" size={300} className={`best-art ${artist ? 'round' : ''}`} />
        <span className="best-kind mono">{artist ? '艺人' : '单曲'}</span>
        <h3 className="best-name">{artist?.name ?? track!.name}</h3>
        {meta && <p className="best-meta">{meta}</p>}
      </a>
      <button className="best-play" onClick={(e) => void play(e)} disabled={busy} aria-label={artist ? `播放${artist.name}的热门歌曲` : `播放《${track!.name}》`}>
        <Icon name="play" />
      </button>
    </article>
  );
}

// ---------------- 综合页 ----------------

function SectionHead({ title, total, unit, onMore, children }: { title: string; total?: number; unit?: string; onMore?: () => void; children?: React.ReactNode }) {
  return (
    <div className="section-head s-head">
      <h2>{title}</h2>
      {!!total && (
        <span className="mono faint s-count">
          {total} {unit}
        </span>
      )}
      <div className="s-head-side">
        {children}
        {onMore && (
          <button className="text-btn s-more" onClick={onMore}>
            全部 <Icon name="arrow" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function CardRail({ title, total, unit, onMore, children }: { title: string; total: number; unit: string; onMore: () => void; children: React.ReactNode }) {
  const rail = useRail({ expandable: false });
  return (
    <section className="section s-section">
      <SectionHead title={title} total={total} unit={unit} onMore={onMore}>
        {rail.controls}
      </SectionHead>
      <div ref={rail.ref} className={`shelf ${rail.className}`}>
        {children}
      </div>
    </section>
  );
}

function OverviewView({ q, data, goTab }: { q: string; data: Overview; goTab: (t: TabKey) => void }) {
  const best = pickBest(q, data);
  const tracks = data.tracks.items;
  const top = tracks.slice(0, OVERVIEW.topTracks);
  const more = tracks.slice(OVERVIEW.topTracks, OVERVIEW.topTracks + OVERVIEW.moreTracks);

  if (!best && !data.playlists.items.length) {
    return (
      <Empty title={`没找到「${q}」`}>
        <p className="muted">换个关键词，或者少打几个字试试。</p>
      </Empty>
    );
  }

  return (
    <>
      <div className={`search-top ${top.length ? '' : 'solo'}`}>
        {best && (
          <section className="reveal">
            <SectionHead title="最佳匹配" />
            <BestMatch best={best} tracks={tracks} />
          </section>
        )}
        {top.length > 0 && (
          <section className="search-songs reveal" style={{ '--i': 1 } as React.CSSProperties}>
            <SectionHead title="单曲" total={data.tracks.total} unit="首" onMore={() => goTab('track')} />
            <TrackList tracks={top} covers showAlbum={false} highlight={q} />
          </section>
        )}
      </div>

      {data.artists.items.length > 0 && (
        <CardRail title="艺人" total={data.artists.total} unit="位" onMore={() => goTab('artist')}>
          {data.artists.items.map((a, i) => (
            <ArtistCard key={a.id} a={a} index={i} />
          ))}
        </CardRail>
      )}
      {data.playlists.items.length > 0 && (
        <CardRail title="歌单" total={data.playlists.total} unit="张" onMore={() => goTab('playlist')}>
          {data.playlists.items.map((p, i) => (
            <PlaylistCard key={p.id} p={p} index={i} />
          ))}
        </CardRail>
      )}
      {more.length > 0 && (
        <section className="section s-section">
          <SectionHead title="更多单曲" onMore={() => goTab('track')} />
          <TrackList tracks={more} covers highlight={q} start={OVERVIEW.topTracks} />
          {data.tracks.total > tracks.length && (
            <button className="btn s-all" onClick={() => goTab('track')}>
              看全部 {data.tracks.total} 首 <Icon name="arrow" />
            </button>
          )}
        </section>
      )}
    </>
  );
}

// ---------------- 没输入时 ----------------

function Landing({ go, hot, loading }: { go: (kw: string) => void; hot: string[]; loading: boolean }) {
  const history = useStore(searchHistoryStore, (s) => s.words);
  return (
    <>
      {history.length > 0 && (
        <section className="section s-section">
          <SectionHead title="最近搜过">
            <button className="text-btn" onClick={clearSearchHistory}>
              清空
            </button>
          </SectionHead>
          <div className="history">
            {history.map((w, i) => (
              <span key={w} className="history-chip reveal" style={{ '--i': i } as React.CSSProperties}>
                <button onClick={() => go(w)}>{w}</button>
                <button className="history-x" onClick={() => forgetSearch(w)} aria-label={`删掉「${w}」`}>
                  <Icon name="close" size={13} />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
      <section className="section s-section">
        <SectionHead title="大家在搜" />
        {loading && <Loading rows={3} />}
        <ol className="hot-rank" style={{ '--rows': Math.ceil(hot.length / 2) } as React.CSSProperties}>
          {hot.map((w, i) => (
            <li key={w} className="reveal" style={{ '--i': i } as React.CSSProperties}>
              <button className={i < 3 ? 'top' : ''} onClick={() => go(w)}>
                <span className="hot-no">{i + 1}</span>
                <span className="hot-word">{w}</span>
                <Icon name="arrow" size={16} />
              </button>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

// ---------------- 页面 ----------------

export function SearchView({ q, type }: { q: string; type: string }) {
  const tab: TabKey = (searchTabs.find((t) => t.key === type)?.key ?? searchTabs[0].key) as TabKey;
  const [text, setText] = useState(q);
  const [page, setPage] = useState(1);
  const [suggest, setSuggest] = useState<string[]>([]);
  const [focus, setFocus] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setText(q), [q]);
  useEffect(() => setPage(1), [q, tab]);
  useEffect(() => {
    if (!q) inputRef.current?.focus();
    else rememberSearch(q);
  }, [q]);

  const assist = useAsync(() => music.searchAssist(''), []);

  // 输入时联想，200ms 防抖，旧请求直接取消
  useEffect(() => {
    const kw = text.trim();
    if (!kw || kw === q) return setSuggest([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      music
        .searchAssist(kw, ctrl.signal)
        .then((r) => setSuggest(r.suggestions.slice(0, 8)))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, q]);

  const result = useAsync(async () => {
    if (!q) return null;
    if (tab === 'all') return { tab, ...(await searchAll(q)) } as const;
    if (tab === 'artist') return { tab, ...(await music.searchArtists(q, page)) } as const;
    if (tab === 'playlist') return { tab, ...(await music.searchPlaylists(q, page)) } as const;
    return { tab: 'track', ...(await music.searchTracks(q, page)) } as const;
  }, [q, tab, page]);

  useLayoutEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('button.on');
    if (el && lineRef.current) {
      lineRef.current.style.width = `${el.offsetWidth}px`;
      lineRef.current.style.transform = `translateX(${el.offsetLeft}px)`;
    }
  }, [tab, q]);

  const go = (kw: string) => {
    setSuggest([]);
    setCursor(-1);
    inputRef.current?.blur();
    if (kw.trim()) navigate(href.search(kw.trim(), tab === 'all' ? undefined : tab));
  };
  const goTab = (t: TabKey) => {
    navigate(href.search(q, t === 'all' ? undefined : t));
    tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const turn = (n: number) => {
    setPage(n);
    tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const r = result.data;
  const paged = r && r.tab !== 'all' ? r : null;
  const pages = paged ? Math.ceil(paged.total / api.pageSize) : 0;
  const showSuggest = focus && suggest.length > 0;
  const placeholder = assist.data?.defaultKeyword ? `试试「${assist.data.defaultKeyword}」` : '找一首歌、一位艺人或一张歌单';

  return (
    <div className="page search-page">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(cursor >= 0 ? suggest[cursor] : text || assist.data?.defaultKeyword || '');
        }}
        role="search"
        className="search-form"
      >
        <label className={`search-box ${focus ? 'focus' : ''}`}>
          <Icon name="search" />
          <span className="sr-only">搜索</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCursor(-1);
            }}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 120)}
            onKeyDown={(e) => {
              if (!showSuggest) return;
              if (e.key === 'ArrowDown') setCursor((c) => (c + 1) % suggest.length);
              else if (e.key === 'ArrowUp') setCursor((c) => (c <= 0 ? suggest.length - 1 : c - 1));
              else return;
              e.preventDefault();
            }}
            placeholder={placeholder}
            enterKeyHint="search"
            role="combobox"
            aria-expanded={showSuggest}
            aria-controls="search-suggest"
          />
          {text && (
            <button type="button" className="icon-btn" aria-label="清空" onClick={() => (setText(''), inputRef.current?.focus())}>
              <Icon name="close" />
            </button>
          )}
        </label>
        {showSuggest && (
          <ul className="suggest" id="search-suggest" role="listbox">
            {suggest.map((s, i) => (
              <li key={s} role="option" aria-selected={i === cursor}>
                <button type="button" className={i === cursor ? 'on' : ''} onMouseDown={() => go(s)}>
                  <Icon name="search" size={15} /> <Highlight text={s} q={text} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {!q && <Landing go={go} hot={assist.data?.hotKeywords ?? []} loading={assist.loading} />}

      {q && (
        <>
          <div className="tabs" role="tablist" ref={tabsRef}>
            {searchTabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => goTab(t.key)}>
                {t.label}
              </button>
            ))}
            <span className="tab-line" ref={lineRef} aria-hidden="true" />
            {paged && <span className="mono faint tabs-count">共 {paged.total} 条</span>}
          </div>

          {result.loading && <Loading />}
          {result.error && <ErrorState error={result.error} onRetry={result.reload} />}
          {r?.tab === 'all' && <OverviewView q={q} data={r} goTab={goTab} />}
          {paged && paged.items.length === 0 && (
            <Empty title={`没找到「${q}」`}>
              <p className="muted">换个关键词，或者切到别的分类看看。</p>
            </Empty>
          )}
          {paged?.tab === 'track' && paged.items.length > 0 && (
            <TrackList tracks={paged.items} covers highlight={q} start={(page - 1) * api.pageSize} />
          )}
          {paged?.tab === 'artist' && paged.items.length > 0 && (
            <div className="grid-cards">
              {paged.items.map((a, i) => (
                <ArtistCard key={a.id} a={a} index={i} />
              ))}
            </div>
          )}
          {paged?.tab === 'playlist' && paged.items.length > 0 && (
            <div className="grid-cards">
              {paged.items.map((p, i) => (
                <PlaylistCard key={p.id} p={p} index={i} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="pager">
              <button className="btn" disabled={page <= 1} onClick={() => turn(page - 1)}>
                上一页
              </button>
              <span className="mono faint">
                {page} / {pages}
              </span>
              <button className="btn" disabled={page >= pages} onClick={() => turn(page + 1)}>
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
