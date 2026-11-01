import { useEffect, useMemo, useState } from 'react';
import type { Track } from '../api';
import { Avatar } from '../components/Avatar';
import { Card } from '../components/Cards';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Empty } from '../components/States';
import { TrackList } from '../components/TrackList';
import { Vinyl } from '../components/Vinyl';
import { authStore, displayName, libraryStore, pullLibrary } from '../lib/account';
import { tintVars, useTint } from '../lib/palette';
import { kindOf, playlistCover } from '../lib/playlists';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { currentTrack, playerStore, playList } from '../player/player';
import { uiStore } from '../player/ui';

type Tab = 'favorites' | 'playlists' | 'recent';

/** 歌单一栏：开头两张「空封套」是新建和导入，后面是自建歌单和收藏的网易云歌单 */
function Playlists() {
  const all = useStore(libraryStore, (s) => s.importedPlaylists);
  const list = useMemo(() => Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt), [all]);
  return (
    <div className="grid-cards pl-grid">
      <button className="card pl-blank reveal" style={{ '--i': 0 } as React.CSSProperties} onClick={() => uiStore.set({ playlist: { mode: 'create', open: true } })}>
        <span className="pl-blank-sleeve">
          <Icon name="plus" size={30} />
        </span>
        <span className="card-text">
          <span className="card-meta mono">新建</span>
          <span className="card-title">压一张新唱片</span>
          <span className="card-desc">自己挑歌、排序，登录后多端同步</span>
        </span>
      </button>
      <button className="card pl-blank reveal" style={{ '--i': 1 } as React.CSSProperties} onClick={() => uiStore.set({ importing: true })}>
        <span className="pl-blank-sleeve">
          <Icon name="link" size={30} />
        </span>
        <span className="card-text">
          <span className="card-meta mono">导入</span>
          <span className="card-title">粘贴歌单链接</span>
          <span className="card-desc">网易云链接、分享文案或短链接</span>
        </span>
      </button>
      {list.map((p, i) => {
        const mine = kindOf(p) === 'mine';
        return (
          <Card
            key={p.id}
            index={i + 2}
            title={p.name}
            subtitle={p.description}
            meta={mine ? `我的 · ${p.tracks.length} 首` : '网易云歌单'}
            coverUrl={playlistCover(p)}
            heroKey={mine ? `mine:${p.id}` : `playlist:${p.id}`}
            to={mine ? href.mine(p.id) : href.playlist(p.id)}
          />
        );
      })}
    </div>
  );
}

/** 页头角上的唱片箱：最新收藏的一张在最前，唱片从封套里探出来，正在放它就转；后面斜靠着几张 */
function Crate({ tracks }: { tracks: Track[] }) {
  const front = tracks[0];
  const spinning = useStore(playerStore, (s) => !!front && s.playing && currentTrack(s)?.id === front.id);
  const cover = (t?: Track) => t?.coverUrl ?? t?.album?.coverUrl;
  return (
    <div className={`crate ${front ? '' : 'empty'}`} aria-hidden="true">
      {[3, 2, 1].map((k) => (
        <span key={k} className="crate-back" style={{ '--k': k } as React.CSSProperties}>
          {tracks[k] && <Cover src={cover(tracks[k])} alt="" size={200} />}
        </span>
      ))}
      {front && <Vinyl cover={cover(front)} spinning={spinning} className="crate-vinyl" labelPx={120} />}
      <span className="crate-front">{front && <Cover src={cover(front)} alt="" size={300} />}</span>
    </div>
  );
}

/** 随机播放：洗一遍牌再从头放，不改播放器的播放模式 */
function shuffled<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const minutes = (tracks: Track[]) => Math.round(tracks.reduce((n, t) => n + (t.durationMs || 0), 0) / 60000);

const TAB_KEY = 'cph.library.tab';

export function Library() {
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  const favorites = useStore(libraryStore, (s) => s.favorites);
  const order = useStore(libraryStore, (s) => s.favoriteOrder);
  const recent = useStore(libraryStore, (s) => s.recent);
  const playlistCount = useStore(libraryStore, (s) => Object.keys(s.importedPlaylists).length);
  // 记住上次看的是哪一栏：从歌单返回时还停在歌单
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem(TAB_KEY) as Tab | null) ?? 'favorites';
    } catch {
      return 'favorites';
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      /* 存不了就每次回到默认栏 */
    }
  }, [tab]);

  useEffect(() => {
    void pullLibrary();
  }, []);

  // 进入页面时固定一次顺序，取消收藏不会让行立刻消失
  const [favSnapshot] = useState(() => order.map((id) => favorites[id]).filter(Boolean));
  const favList = favSnapshot.length ? favSnapshot : order.map((id) => favorites[id]).filter(Boolean);
  const list = tab === 'favorites' ? favList : recent;

  const shelf = favList.length ? favList : recent;
  const tint = useTint(shelf[0]?.coverUrl ?? shelf[0]?.album?.coverUrl);
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'favorites', label: '收藏', n: order.length },
    { key: 'playlists', label: '歌单', n: playlistCount },
    { key: 'recent', label: '最近播放', n: recent.length },
  ];
  const at = tabs.findIndex((t) => t.key === tab);

  return (
    <div className="page">
      <header className={`page-head shelf-head reveal ${tint ? 'tinted' : ''}`} style={tintVars(tint)}>
        <div className="detail-band" aria-hidden="true" />
        <div className="shelf-intro">
          <div className="kicker">唱片架 · Shelf</div>
          <h1 className="page-title">{user ? displayName(user) : '我的唱片架'}</h1>
        </div>
        <Crate tracks={shelf.slice(0, 4)} />
        {status === 'authenticated' && user ? (
          <div className="account-line">
            <Avatar user={user} size={28} />
            <span className="muted small account-mail">{user.email} · 已同步</span>
            <a className="text-btn" href={href.account()}>
              个人中心
            </a>
          </div>
        ) : status === 'guest' ? (
          <div className="account-line">
            <span className="muted small">收藏只存在这台设备上。</span>
            <button className="text-btn" onClick={() => uiStore.set({ login: true })}>
              登录后同步
            </button>
          </div>
        ) : null}
      </header>

      <div className="shelf-tabs" role="tablist" style={{ '--at': at } as React.CSSProperties}>
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-label={`${t.label} ${t.n}`} aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="shelf-n">{String(t.n).padStart(2, '0')}</span>
            <span className="shelf-l">{t.label}</span>
          </button>
        ))}
      </div>

      {(tab === 'playlists' || list.length > 0) && (
        <div className="shelf-bar">
          <span className="mono faint">
            {tab === 'playlists' ? `${playlistCount} 张歌单` : `${list.length} 首 · ${minutes(list)} 分钟`}
          </span>
          {tab !== 'playlists' && list.length > 0 && (
            <span className="shelf-actions">
              <button className="btn solid" onClick={() => playList(list)}>
                <Icon name="play" size={14} /> 全部播放
              </button>
              <button className="btn shelf-shuffle" onClick={() => playList(shuffled(list))} aria-label="随机播放" title="随机播放">
                <Icon name="shuffle" size={16} />
                <span>随机</span>
              </button>
            </span>
          )}
        </div>
      )}

      {tab === 'playlists' ? (
        <Playlists />
      ) : list.length === 0 ? (
        <Empty title={tab === 'favorites' ? '还没有收藏' : '还没听过歌'}>
          <p className="muted">{tab === 'favorites' ? '在任意曲目旁点一下心形，它就会摆到这里。' : '放一首歌，这里就会记下来。'}</p>
        </Empty>
      ) : (
        <TrackList key={tab} tracks={list} covers />
      )}
    </div>
  );
}
