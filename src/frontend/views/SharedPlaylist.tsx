import type { Track } from '../api';
import { DetailHeader } from '../components/DetailHeader';
import { Icon } from '../components/Icon';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { authStore } from '../lib/account';
import { fetchShared, messagesStore } from '../lib/messages';
import { createPlaylist } from '../lib/playlists';
import { href, navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';
import { uiStore } from '../player/ui';
import { peerName, stampText } from './Chat';
import { PlayActions, totalTime } from './Collection';

/**
 * 私信里别人分享的自建歌单：分享那一刻的快照，原歌单后来怎么改都不影响。
 * 可以直接放、加到自己的歌单，或者整张存一份成自己的歌单；不会把对方的歌单 id 当成自己的打开
 */
export function SharedPlaylistView({ peerId, messageId }: { peerId: string; messageId: string }) {
  const status = useStore(authStore, (s) => s.status);
  if (status === 'checking') {
    return (
      <div className="page">
        <Loading />
      </div>
    );
  }
  if (status !== 'authenticated') {
    return (
      <div className="page">
        <Empty title="登录后才能打开朋友分享的歌单">
          <button className="btn" onClick={() => uiStore.set({ login: true })} style={{ marginTop: 18 }}>
            登录
          </button>
        </Empty>
      </div>
    );
  }
  return <Snapshot peerId={peerId} messageId={messageId} />;
}

function Snapshot({ peerId, messageId }: { peerId: string; messageId: string }) {
  const heroKey = `shared:${messageId}`;
  const { data, error, loading, reload } = useAsync(() => fetchShared(messageId), [messageId], heroKey);
  const peer = useStore(messagesStore, (s) => s.conversations[peerId]?.peer);
  const sentAt = useStore(messagesStore, (s) => s.threads[peerId]?.messages.find((m) => m.id === messageId)?.createdAt);
  const pl = data?.kind === 'playlist' ? data.playlist : null;
  const tracks: Track[] = pl?.tracks ?? [];

  const keep = () => {
    if (!pl) return;
    const mine = createPlaylist(pl.name, pl.description, tracks);
    toast(`存成了你的歌单《${mine.name}》，可以随意增删。`);
    navigate(href.mine(mine.id));
  };

  return (
    <div className="page">
      {pl && (
        <DetailHeader
          heroKey={heroKey}
          kind="朋友分享的歌单"
          title={pl.name}
          coverUrl={tracks[0]?.coverUrl ?? tracks[0]?.album?.coverUrl ?? pl.coverUrl}
          byline={
            <a href={href.chat(peerId)}>
              <Icon name="chat" size={15} /> 来自{peer ? ` ${peerName(peer)} ` : '私信'}的分享
            </a>
          }
          description={pl.description}
          meta={[`${tracks.length} 首`, tracks.length > 0 && totalTime(tracks), sentAt && `${stampText(sentAt)} 分享`]}
          actions={
            <>
              <PlayActions tracks={tracks} addable />
              <button className="btn ghost" onClick={keep} disabled={!tracks.length}>
                <Icon name="listAdd" /> 存一份到唱片架
              </button>
            </>
          }
        />
      )}
      {loading && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && !pl && <Empty title="这张卡片里没有歌单" />}
      {pl && (tracks.length ? <TrackList tracks={tracks} covers /> : <p className="muted">分享的时候这张歌单还是空的。</p>)}
    </div>
  );
}
