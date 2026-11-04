import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { coverOf } from './api';
import { DmNotice } from './components/DmNotice';
import { ShareDialog } from './components/ShareDialog';
import { ListenDrawer, ListenInviteCard } from './components/ListenDrawer';
import { LoginDialog } from './components/LoginDialog';
import { NowPlaying } from './components/NowPlaying';
import { ImportDialog, PlaylistDialog } from './components/PlaylistDialogs';
import { PlayerBar, toggleNowPlaying } from './components/PlayerBar';
import { QueueDrawer } from './components/QueueDrawer';
import { Sidebar } from './components/Sidebar';
import { Empty } from './components/States';
import { Toast } from './components/Toast';
import { RECORD_LAND_MS } from './components/Turntable';
import { TrackMenu } from './components/TrackMenu';
import { restoreSession, watchSessionRecovery } from './lib/account';
import { watchAccountEvents } from './lib/events';
import { watchSocial } from './lib/friends';
import { watchListen } from './lib/listen';
import { applyGlobalTint, DEFAULT_TINT, tintOf, type Tint } from './lib/palette';
import { href, navigate, useRoute, type Route } from './lib/router';
import { getSettings, motionEnabled, subscribeSettings } from './lib/settings';
import { useStore } from './lib/store';
import { currentTrack, next, playerStore, prev, seek, toggle } from './player/player';
import { uiStore } from './player/ui';
import { Charts } from './views/Charts';
import { AlbumView, ArtistView, PlaylistView } from './views/Collection';
import { Home } from './views/Home';
import { AccountView } from './views/AccountView';
import { AdminView } from './views/Admin';
import { Library } from './views/Library';
import { ChatView } from './views/Chat';
import { FriendsView } from './views/Friends';
import { MyPlaylistView } from './views/MyPlaylist';
import { RadioView } from './views/Radio';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';
import { HelpView } from './views/HelpView';
import { SharedPlaylistView } from './views/SharedPlaylist';

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
    case 'help':
      return <HelpView topic={route.query.get('q') ?? ''} />;
    case 'admin':
      return <AdminView />;
    case 'account':
      return <AccountView />;
    case 'friends':
      return <FriendsView />;
    case 'chat':
      if (route.parts[2] === 'shared' && route.parts[3]) return <SharedPlaylistView key={route.parts[3]} peerId={id} messageId={route.parts[3]} />;
      return <ChatView key={id} peerId={id} />;
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

/** 单独一个组件订阅正在放的封面：换歌时只有它重渲染，不会把整个应用（含几百行的歌单）从根上重渲染一遍 */
function GlobalTint() {
  const cover = useStore(playerStore, (s) => {
    const t = currentTrack(s);
    return t ? coverOf(t) : undefined;
  });

  // 全站强调色跟着正在播放的封面走。不在根元素上做颜色过渡：根上的继承属性一动，
  // 整页每一帧都要重算样式、重画所有用到强调色的地方，换歌时连台式机都掉帧；
  // 色相按数字插值还会从橙一路经过黄、绿才到蓝。改成一下子换掉：
  // 唱机开着时等新唱片落稳那一刻再换（和唱盘的光圈、指示灯同一拍），收着时立刻换
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const landAt = performance.now() + (uiStore.get().nowPlaying && motionEnabled() ? RECORD_LAND_MS : 0);
    const apply = (t: Tint) => {
      if (!alive) return;
      timer = window.setTimeout(() => applyGlobalTint(t), Math.max(0, landAt - performance.now()));
    };
    if (!cover) apply(DEFAULT_TINT);
    else void tintOf(cover).then(apply);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [cover]);
  return null;
}

export function App() {
  const route = useRoute();
  const settings = useSyncExternalStore(subscribeSettings, getSettings);
  const mainRef = useRef<HTMLElement>(null);

  useShortcuts();

  useEffect(() => {
    const stop = watchSessionRecovery();
    void restoreSession();
    watchSocial();
    const stopListen = watchListen();
    const stopEvents = watchAccountEvents();
    return () => { stopEvents?.(); stopListen?.(); stop(); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = settings.theme;
    root.dataset.motion = settings.motion;
  }, [settings.theme, settings.motion]);

  // 切页时回到顶部（返回时回到离开时的位置），收起浮层。
  // 用 layout effect：要在视图过渡拍新快照之前滚好
  useLayoutEffect(() => {
    mainRef.current?.scrollTo(0, route.scrollY);
    uiStore.set({ nowPlaying: false, queue: false, listen: false, menu: null });
  }, [route.path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <GlobalTint />
      <Sidebar />
      <main className="main" ref={mainRef}>
        <View route={route} />
      </main>
      <PlayerBar />
      <NowPlaying />
      <QueueDrawer />
      <ListenDrawer />
      <ListenInviteCard />
      <DmNotice />
      <LoginDialog />
      <PlaylistDialog />
      <ImportDialog />
      <TrackMenu />
      <ShareDialog />
      <Toast />
    </div>
  );
}
