import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Card } from '../components/Cards';
import { Icon } from '../components/Icon';
import { Empty } from '../components/States';
import { TrackList } from '../components/TrackList';
import { authStore, displayName, libraryStore, logout, pullLibrary } from '../lib/account';
import { kindOf, playlistCover } from '../lib/playlists';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { playList } from '../player/player';
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

  return (
    <div className="page">
      <header className="page-head reveal">
        <div className="kicker">唱片架</div>
        <h1 className="page-title">{user ? displayName(user) : '我的唱片架'}</h1>
        {status === 'authenticated' && user ? (
          <div className="account-line">
            <Avatar user={user} size={28} />
            <span className="muted small">{user.email} · 已同步</span>
            <button className="text-btn" onClick={logout}>
              退出
            </button>
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

      <div className="seg" role="tablist" style={{ marginTop: 8 }}>
        <button role="tab" aria-selected={tab === 'favorites'} className={tab === 'favorites' ? 'on' : ''} onClick={() => setTab('favorites')}>
          收藏 <span className="mono">{order.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'playlists'} className={tab === 'playlists' ? 'on' : ''} onClick={() => setTab('playlists')}>
          歌单 <span className="mono">{playlistCount}</span>
        </button>
        <button role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')}>
          最近播放 <span className="mono">{recent.length}</span>
        </button>
        {tab !== 'playlists' && list.length > 0 && (
          <button className="seg-action" onClick={() => playList(list)}>
            <Icon name="play" size={14} /> 全部播放
          </button>
        )}
      </div>

      {tab === 'playlists' ? (
        <Playlists />
      ) : list.length === 0 ? (
        <Empty title={tab === 'favorites' ? '还没有收藏' : '还没听过歌'}>
          <p className="muted">{tab === 'favorites' ? '在任意曲目旁点一下心形，它就会摆到这里。' : '放一首歌，这里就会记下来。'}</p>
        </Empty>
      ) : (
        <TrackList key={tab} tracks={list} />
      )}
    </div>
  );
}
