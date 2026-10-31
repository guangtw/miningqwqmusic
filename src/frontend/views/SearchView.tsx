import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { music } from '../api';
import { ArtistCard, PlaylistCard } from '../components/Cards';
import { Icon } from '../components/Icon';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { api, searchTabs } from '../config/site';
import { href, navigate } from '../lib/router';
import { useAsync } from '../lib/useAsync';

type TabKey = (typeof searchTabs)[number]['key'];

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
    if (kw.trim()) navigate(href.search(kw.trim(), tab));
  };

  const r = result.data;
  const pages = r ? Math.ceil(r.total / api.pageSize) : 0;
  const showSuggest = focus && suggest.length > 0;
  const placeholder = assist.data?.defaultKeyword ? `试试「${assist.data.defaultKeyword}」` : '找一首歌、一位艺人或一张歌单';

  return (
    <div className="page">
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
                  <Icon name="search" size={15} /> {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {!q && (
        <section className="section">
          <div className="section-head reveal">
            <span className="section-no">热</span>
            <h2>大家在搜</h2>
          </div>
          {assist.loading && <Loading rows={3} />}
          <div className="hot">
            {assist.data?.hotKeywords.map((w, i) => (
              <button key={w} className="hot-chip reveal" style={{ '--i': i } as React.CSSProperties} onClick={() => go(w)}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                {w}
              </button>
            ))}
          </div>
        </section>
      )}

      {q && (
        <>
          <div className="tabs" role="tablist" ref={tabsRef}>
            {searchTabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'on' : ''}
                onClick={() => navigate(href.search(q, t.key))}
              >
                {t.label}
              </button>
            ))}
            <span className="tab-line" ref={lineRef} aria-hidden="true" />
            {r && <span className="mono faint tabs-count">共 {r.total} 条</span>}
          </div>

          {result.loading && <Loading />}
          {result.error && <ErrorState error={result.error} onRetry={result.reload} />}
          {r && r.items.length === 0 && (
            <Empty title={`没找到「${q}」`}>
              <p className="muted">换个关键词，或者切到别的分类看看。</p>
            </Empty>
          )}
          {r?.tab === 'track' && r.items.length > 0 && <TrackList tracks={r.items} />}
          {r?.tab === 'artist' && r.items.length > 0 && (
            <div className="grid-cards">
              {r.items.map((a, i) => (
                <ArtistCard key={a.id} a={a} index={i} />
              ))}
            </div>
          )}
          {r?.tab === 'playlist' && r.items.length > 0 && (
            <div className="grid-cards">
              {r.items.map((p, i) => (
                <PlaylistCard key={p.id} p={p} index={i} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="pager">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <span className="mono faint">
                {page} / {pages}
              </span>
              <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
