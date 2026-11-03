import { useEffect, useState } from 'react';
import type { Track } from '../api';
import { DetailHeader } from '../components/DetailHeader';
import { Icon } from '../components/Icon';
import { ReorderList } from '../components/ReorderList';
import { Empty } from '../components/States';
import { TrackList } from '../components/TrackList';
import { authStore, libraryStore, pullLibrary } from '../lib/account';
import { deletePlaylist, isMine, playlistCover, reorderPlaylist } from '../lib/playlists';
import { href, navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';
import { PlayActions, totalTime } from './Collection';

const updatedLabel = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日更新`;
};

/** 自建歌单：曲目存在唱片架里，可以改名、拖动排序、移除、删除整张 */
export function MyPlaylistView({ id }: { id: string }) {
  const pl = useStore(libraryStore, (s) => s.importedPlaylists[id]);
  const pending = useStore(libraryStore, (s) => s.pendingPlaylists[id]);
  const status = useStore(authStore, (s) => s.status);
  const [confirming, setConfirming] = useState(false);
  // 整理顺序：先在草稿里排，点「完成」一次提交
  const [draft, setDraft] = useState<Track[] | null>(null);
  const heroKey = `mine:${id}`;

  useEffect(() => {
    void pullLibrary();
  }, []);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (!isMine(pl)) {
    return (
      <div className="page">
        <Empty title="这张歌单不在唱片架上">
          <p className="muted">可能已经在别的设备上删掉了。</p>
          <a className="btn" href={href.library()} style={{ marginTop: 18 }}>
            回唱片架
          </a>
        </Empty>
      </div>
    );
  }

  const remove = () => {
    if (!confirming) return setConfirming(true);
    void deletePlaylist(id);
    toast(`《${pl.name}》删掉了。`);
    navigate(href.library());
  };

  const sync = status !== 'authenticated' ? '只在本机' : pending ? '等待同步' : '已同步';
  // 整理期间别处加了歌、删了歌：草稿按现在的曲目重排，别丢歌也别多出已删的
  const arranging = draft
    ? [...draft.filter((t) => pl.tracks.some((x) => x.id === t.id)), ...pl.tracks.filter((t) => !draft.some((x) => x.id === t.id))]
    : null;
  const finish = () => {
    if (arranging) void reorderPlaylist(id, arranging);
    setDraft(null);
  };

  return (
    <div className="page">
      <DetailHeader
        heroKey={heroKey}
        kind="我的歌单"
        title={pl.name}
        coverUrl={playlistCover(arranging ? { ...pl, tracks: arranging } : pl)}
        description={pl.description}
        meta={[`${pl.tracks.length} 首`, pl.tracks.length > 0 && totalTime(pl.tracks), updatedLabel(pl.updatedAt), sync]}
        actions={
          <>
            <PlayActions tracks={pl.tracks} />
            <button className="btn" onClick={() => uiStore.set({ playlist: { mode: 'edit', id } })}>
              <Icon name="edit" /> 编辑
            </button>
            {pl.tracks.length > 1 && !draft && (
              <button className="btn" onClick={() => setDraft(pl.tracks)}>
                <Icon name="sort" /> 整理顺序
              </button>
            )}
            <button className={`btn ${confirming ? 'danger' : 'ghost'}`} onClick={remove} aria-live="polite">
              <Icon name="trash" /> {confirming ? '再点一次删除' : '删除'}
            </button>
          </>
        }
      />
      {arranging ? (
        <>
          <div className="arrange-bar">
            <span>按住右边的把手上下拖，第一首的封面就是歌单封面。</span>
            <button className="btn sm ghost" onClick={() => setDraft(null)}>
              取消
            </button>
            <button className="btn sm solid" onClick={finish}>
              <Icon name="check" size={16} /> 完成
            </button>
          </div>
          <ReorderList tracks={arranging} onChange={setDraft} />
        </>
      ) : pl.tracks.length ? (
        <>
          <p className="muted small list-hint">拖动曲目或点「整理顺序」可以排序，右键或「⋯」可以移除。</p>
          <TrackList tracks={pl.tracks} playlistId={id} covers />
        </>
      ) : (
        <Empty title="还是一张空白唱片">
          <p className="muted">在任意曲目的「⋯」菜单里选「加到歌单」，或者右键曲目。</p>
          <a className="btn" href={href.search()} style={{ marginTop: 18 }}>
            <Icon name="search" /> 去找歌
          </a>
        </Empty>
      )}
    </div>
  );
}
