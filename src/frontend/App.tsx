import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { coverOf } from './api';
import { LoginDialog } from './components/LoginDialog';
import { NowPlaying } from './components/NowPlaying';
import { PlayerBar, toggleNowPlaying } from './components/PlayerBar';
import { QueueDrawer } from './components/QueueDrawer';
import { Sidebar } from './components/Sidebar';
import { Empty } from './components/States';
import { Toast } from './components/Toast';
import { restoreSession } from './lib/account';
import { applyGlobalTint, DEFAULT_TINT, tintOf } from './lib/palette';
import { href, navigate, useRoute, type Route } from './lib/router';
import { getSettings, subscribeSettings } from './lib/settings';
import { useStore } from './lib/store';
import { currentTrack, next, playerStore, prev, seek, toggle } from './player/player';
import { uiStore } from './player/ui';
import { Charts } from './views/Charts';
import { AlbumView, ArtistView, PlaylistView } from './views/Collection';
import { Home } from './views/Home';
import { Library } from './views/Library';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';

function View({ route }: { route: Route }) {
  const [section, id] = route.parts;
  switch (section) {
    case undefined:
      return <Home />;
    case 'playlist':
      return <PlaylistView id={id} source="playlist" />;
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
    case 'library':
      return <Library />;
    case 'settings':
      return <SettingsView />;
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
    void restoreSession();
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
    uiStore.set({ nowPlaying: false, queue: false });
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
      <LoginDialog />
      <Toast />
    </div>
  );
}
