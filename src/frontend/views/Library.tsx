import { useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Empty } from '../components/States';
import { TrackList } from '../components/TrackList';
import { authStore, displayName, libraryStore, logout, pullLibrary } from '../lib/account';
import { useStore } from '../lib/store';
import { useEffect } from 'react';
import { playList } from '../player/player';
import { uiStore } from '../player/ui';

type Tab = 'favorites' | 'recent';

export function Library() {
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  const favorites = useStore(libraryStore, (s) => s.favorites);
  const order = useStore(libraryStore, (s) => s.favoriteOrder);
  const recent = useStore(libraryStore, (s) => s.recent);
  const [tab, setTab] = useState<Tab>('favorites');

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
        <button role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')}>
          最近播放 <span className="mono">{recent.length}</span>
        </button>
        {list.length > 0 && (
          <button className="seg-action" onClick={() => playList(list)}>
            <Icon name="play" size={14} /> 全部播放
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <Empty title={tab === 'favorites' ? '还没有收藏' : '还没听过歌'}>
          <p className="muted">{tab === 'favorites' ? '在任意曲目旁点一下心形，它就会摆到这里。' : '放一首歌，这里就会记下来。'}</p>
        </Empty>
      ) : (
        <TrackList key={tab} tracks={list} />
      )}
    </div>
  );
}
