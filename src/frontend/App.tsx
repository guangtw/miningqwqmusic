import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { coverOf } from './api';
import { ListenDrawer, ListenInviteCard } from './components/ListenDrawer';
import { LoginDialog } from './components/LoginDialog';
import { NowPlaying } from './components/NowPlaying';
import { ImportDialog, PlaylistDialog } from './components/PlaylistDialogs';
import { PlayerBar, toggleNowPlaying } from './components/PlayerBar';
import { QueueDrawer } from './components/QueueDrawer';
import { Sidebar } from './components/Sidebar';
import { Empty } from './components/States';
import { Toast } from './components/Toast';
import { TrackMenu } from './components/TrackMenu';
import { restoreSession, watchSessionRecovery } from './lib/account';
import { watchSocial } from './lib/friends';
import { watchListen } from './lib/listen';
import { applyGlobalTint, DEFAULT_TINT, tintOf } from './lib/palette';
import { href, navigate, useRoute, type Route } from './lib/router';
import { getSettings, subscribeSettings } from './lib/settings';
import { useStore } from './lib/store';
import { currentTrack, next, playerStore, prev, seek, toggle } from './player/player';
import { uiStore } from './player/ui';
import { Charts } from './views/Charts';
import { AlbumView, ArtistView, PlaylistView } from './views/Collection';
import { Home } from './views/Home';
import { AccountView } from './views/AccountView';
import { AdminView } from './views/Admin';
import { Library } from './views/Library';
import { FriendsView } from './views/Friends';
import { MyPlaylistView } from './views/MyPlaylist';
import { RadioView } from './views/Radio';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';

function View({ route }: { route: Route }) {
  const [section, id] = route.parts;
  switch (section) {
    case undefined:
      return <Home />;
    case 'playlist':
      return <PlaylistView id={id} source="playlist" />;
    case 'mine':
      return <MyPlaylistView id={id} />;
    case 'toplist':
      return <PlaylistView id={id} source="toplist" />;
    case 'album':
      return <AlbumView id={id} />;
    case 'artist':
      return <ArtistView id={id} />;
    case 'search':
      return <SearchView q={route.query.get('q') ?? ''} type={route.query.get('type') ?? ''} />;
    case 'charts':
      return <Charts />;
    case 'radio':
      return <RadioView />;
    case 'library':
      return <Library />;
    case 'settings':
      return <SettingsView />;
    case 'admin':
      return <AdminView />;
    case 'account':
      return <AccountView />;
    case 'friends':
      return <FriendsView />;
    default:
      return (
        <div className="page">
          <Empty title="这一面没有刻纹">
            <a className="btn" href={href.home()} style={{ marginTop: 18 }}>
              回到首页
            </a>
          </Empty>
        </div>
      );
  }
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable], [role="slider"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const { position } = playerStore.get();
      if (e.key === ' ' && !el.closest('button, a')) {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) next();
        else seek(position + 5000);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) prev();
        else seek(position - 5000);
      } else if (e.key === 'l' || e.key === 'L') {
        toggleNowPlaying();
      } else if (e.key === '/') {
        e.preventDefault();
        navigate(href.search());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const route = useRoute();
  const settings = useSyncExternalStore(subscribeSettings, getSettings);
  const cover = useStore(playerStore, (s) => {
    const t = currentTrack(s);
    return t ? coverOf(t) : undefined;
  });
  const mainRef = useRef<HTMLElement>(null);

  useShortcuts();

  useEffect(() => {
    const stop = watchSessionRecovery();
    void restoreSession();
    watchSocial();
    const stopListen = watchListen();
    return () => { stopListen?.(); stop(); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = settings.theme;
    root.dataset.motion = settings.motion;
  }, [settings.theme, settings.motion]);

  // 全站强调色跟着正在播放的封面走（CSS 里注册了 @property，会平滑过渡）
  useEffect(() => {
    let alive = true;
    if (!cover) applyGlobalTint(DEFAULT_TINT);
    else tintOf(cover).then((t) => alive && applyGlobalTint(t));
    return () => {
      alive = false;
    };
  }, [cover]);

  // 切页时回到顶部（返回时回到离开时的位置），收起浮层。
  // 用 layout effect：要在视图过渡拍新快照之前滚好
  useLayoutEffect(() => {
    mainRef.current?.scrollTo(0, route.scrollY);
    uiStore.set({ nowPlaying: false, queue: false, listen: false, menu: null });
  }, [route.path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Sidebar />
      <main className="main" ref={mainRef}>
        <View route={route} />
      </main>
      <PlayerBar />
      <NowPlaying />
      <QueueDrawer />
      <ListenDrawer />
      <ListenInviteCard />
      <LoginDialog />
      <PlaylistDialog />
      <ImportDialog />
      <TrackMenu />
      <Toast />
    </div>
  );
}
