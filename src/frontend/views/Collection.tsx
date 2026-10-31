import { Fragment } from 'react';
import { hasId, music, type Track } from '../api';
import { DetailHeader } from '../components/DetailHeader';
import { Icon } from '../components/Icon';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { formatDate, formatTime } from '../lib/format';
import { getPreview } from '../lib/motion';
import { href } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { playList } from '../player/player';

function totalTime(tracks: Track[]) {
  const ms = tracks.reduce((s, t) => s + t.durationMs, 0);
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} 小时 ${min % 60} 分` : formatTime(ms);
}

export function PlayActions({ tracks }: { tracks: Track[] }) {
  return (
    <>
      <button className="btn solid" onClick={() => playList(tracks)} disabled={!tracks.length}>
        <Icon name="play" /> 放上唱机
      </button>
      <button className="btn" onClick={() => playList([...tracks].sort(() => Math.random() - 0.5))} disabled={!tracks.length}>
        <Icon name="shuffle" /> 随机
      </button>
    </>
  );
}

/** 歌单和榜单结构一样，只是取数接口不同 */
export function PlaylistView({ id, source }: { id: string; source: 'playlist' | 'toplist' }) {
  const heroKey = `${source}:${id}`;
  const { data: p, error, loading, reload } = useAsync(() => (source === 'toplist' ? music.toplist(id) : music.playlist(id)), [id, source], heroKey);
  const preview = getPreview(heroKey);
  const kind = source === 'toplist' ? '榜单' : '歌单';

  return (
    <div className="page">
      {/* 预览和正式数据共用同一个头部，数据回来时只补内容，不重新挂载（否则封面和标题会闪一下） */}
      {(p || (loading && preview)) && (
        <DetailHeader
          heroKey={heroKey}
          kind={kind}
          title={p?.name ?? preview!.title}
          coverUrl={p?.coverUrl ?? preview?.coverUrl}
          description={p?.description}
          meta={p && [`${p.tracks.length} 首`, p.tracks.length > 0 && totalTime(p.tracks)]}
          actions={p && <PlayActions tracks={p.tracks} />}
          pending={!p}
        />
      )}
      {loading && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {p && <TrackList tracks={p.tracks} />}
    </div>
  );
}

export function AlbumView({ id }: { id: string }) {
  const heroKey = `album:${id}`;
  const { data: a, error, loading, reload } = useAsync(() => music.album(id), [id], heroKey);
  const preview = getPreview(heroKey);
  return (
    <div className="page">
      {(a || (loading && preview)) && (
        <DetailHeader
          heroKey={heroKey}
          kind={a ? `专辑${a.publishTime ? ` · ${formatDate(a.publishTime)}` : ''}` : '专辑'}
          title={a?.name ?? preview!.title}
          coverUrl={a?.coverUrl ?? preview?.coverUrl}
          byline={a?.artists.map((r, i) => (
            <Fragment key={`${r.id}-${i}`}>
              {i > 0 && ' / '}
              {hasId(r.id) ? <a href={href.artist(r.id)}>{r.name}</a> : r.name}
            </Fragment>
          ))}
          description={a?.description}
          meta={a && [`${a.tracks.length} 首`, a.tracks.length > 0 && totalTime(a.tracks)]}
          actions={a && <PlayActions tracks={a.tracks} />}
          pending={!a}
        />
      )}
      {loading && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {a && <TrackList tracks={a.tracks} sides showAlbum={false} />}
    </div>
  );
}

export function ArtistView({ id }: { id: string }) {
  const heroKey = `artist:${id}`;
  const { data: a, error, loading, reload } = useAsync(() => music.artist(id), [id], heroKey);
  const preview = getPreview(heroKey);
  return (
    <div className="page">
      {(a || (loading && preview)) && (
        <DetailHeader
          heroKey={heroKey}
          kind="艺人"
          title={a?.name ?? preview!.title}
          coverUrl={a?.coverUrl ?? preview?.coverUrl}
          description={a?.briefDesc}
          meta={a && [`热门 ${a.topTracks.length} 首`]}
          actions={a && <PlayActions tracks={a.topTracks} />}
          round
          pending={!a}
        />
      )}
      {loading && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {a && <TrackList tracks={a.topTracks} />}
    </div>
  );
}
