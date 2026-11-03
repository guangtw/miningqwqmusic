import { useState } from 'react';
import type { DirectMessageContent, ListenInvitationCard } from '@/src/types/social';
import { ApiError } from '../api/http';
import { formatTime } from '../lib/format';
import { acceptInvite, listenStore, rejectInvite } from '../lib/listen';
import { refreshMessage } from '../lib/messages';
import { tintVars, useTint } from '../lib/palette';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { currentTrack, playerStore, playTrack, toggle } from '../player/player';
import { uiStore } from '../player/ui';
import { Cover } from './Cover';
import { Icon } from './Icon';

type Music = Exclude<DirectMessageContent, { kind: 'listen_invite' }>;

/**
 * 私信里的音乐卡片：一张封套，后面藏着半张唱片。
 * 歌曲点一下就放（正在放的那首再点是暂停）；专辑、网易云歌单进详情页按 id 重新取；
 * 自建歌单的快照只有这条消息能打开，进专门的分享页。
 * peerId / messageId 缺省时（还没送达、分享框里的预览）只画样子不可点。
 */
export function MusicCard({ c, peerId, messageId }: { c: Music; peerId?: string; messageId?: string }) {
  const art = c.kind === 'track' ? c.track.coverUrl ?? c.track.album?.coverUrl : c.kind === 'album' ? c.album.coverUrl : c.playlist.coverUrl;
  const tint = useTint(art);
  const playing = useStore(playerStore, (s) => c.kind === 'track' && currentTrack(s)?.id === c.track.id && s.playing);
  const live = !!messageId;

  const [name, sub, meta] =
    c.kind === 'track'
      ? [c.track.name, c.track.artists.map((a) => a.name).join(' / '), ['单曲', c.track.durationMs ? formatTime(c.track.durationMs) : null]]
      : c.kind === 'album'
        ? [c.album.name, c.album.artists.map((a) => a.name).join(' / '), ['专辑', c.album.trackCount != null ? `${c.album.trackCount} 首` : null]]
        : [
            c.playlist.name,
            c.playlist.description ?? '',
            [c.source === 'echo_snapshot' ? '自建歌单' : '歌单', c.playlist.trackCount != null ? `${c.playlist.trackCount} 首` : null],
          ];

  const body = (
    <>
      <span className="mcard-art" aria-hidden="true">
        <span className="mcard-disc" />
        <Cover src={art} alt="" size={128} className="mcard-cover" />
      </span>
      <span className="mcard-text">
        <b>{name}</b>
        {sub && <small>{sub}</small>}
        <span className="mcard-meta mono">{meta.filter(Boolean).join(' · ')}</span>
      </span>
      <span className="mcard-go" aria-hidden="true">
        <Icon name={c.kind !== 'track' ? 'right' : playing ? 'pause' : 'play'} size={c.kind === 'track' ? 15 : 18} />
      </span>
    </>
  );
  const cls = `mcard mcard-${c.kind} ${playing ? 'playing' : ''} ${tint ? 'tinted' : ''}`;
  const style = tintVars(tint);

  if (!live) return <span className={`${cls} still`} style={style}>{body}</span>;
  if (c.kind === 'track') {
    return (
      <button
        className={cls}
        style={style}
        aria-label={playing ? `暂停《${name}》` : `播放《${name}》`}
        onClick={() => (currentTrack()?.id === c.track.id ? toggle() : playTrack(c.track))}
      >
        {body}
      </button>
    );
  }
  const to = c.kind === 'album' ? href.album(c.album.id) : c.source === 'netease' ? href.playlist(c.playlist.id) : peerId ? href.shared(peerId, messageId) : null;
  if (!to) return <span className={`${cls} still`} style={style}>{body}</span>;
  return (
    <a className={cls} style={style} href={to}>
      {body}
    </a>
  );
}

const STATUS: Record<ListenInvitationCard['status'], { mine: string; theirs: string }> = {
  pending: { mine: '等对方回应', theirs: '' },
  accepted: { mine: '对方进来了', theirs: '你进了房间' },
  rejected: { mine: '对方婉拒了', theirs: '你婉拒了' },
  canceled: { mine: '房间已经关了', theirs: '对方已经离开房间' },
  expired: { mine: '邀请过期了', theirs: '邀请过期了' },
  unavailable: { mine: '房间已经不在了', theirs: '房间已经不在了' },
};

/**
 * 一起听邀请：一张入场券。被邀请的人在等待中能「加入 / 不了」，发出邀请的人看到等待状态；
 * 状态由服务端更新（接受、拒绝、取消、过期），这里不自己改。接受了盖一个「入场」章
 */
export function InviteTicket({ inv, me, messageId, peerName }: { inv: ListenInvitationCard; me?: string; messageId: string; peerName: string }) {
  const mine = inv.inviterUserId === me;
  const canAnswer = !mine && inv.inviteeUserId === me && inv.status === 'pending';
  const inRoom = useStore(listenStore, (s) => s.room?.id === inv.roomId);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const t = inv.currentTrack;
  const tint = useTint(t?.coverUrl ?? t?.album?.coverUrl);

  const act = async (kind: 'accept' | 'reject') => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'accept') {
        await acceptInvite(inv.inviteId);
        uiStore.set({ listen: true });
      } else await rejectInvite(inv.inviteId);
    } catch (e) {
      // 满员时邀请还在，等会儿再点；其他错误（过期、房间没了）状态会跟着消息更新
      toast(e instanceof ApiError && e.code === 5506 ? '房间满了，等有人离开再加入。' : (e as Error).message);
    } finally {
      setBusy(null);
      void refreshMessage(messageId).catch(() => undefined);
    }
  };

  const line = mine ? `你邀请 ${peerName} 一起听` : `${peerName} 邀请你一起听`;
  const status = inv.status === 'accepted' && !mine && inRoom ? '你在房间里' : STATUS[inv.status][mine ? 'mine' : 'theirs'];

  return (
    <div className={`ticket ${inv.status} ${tint ? 'tinted' : ''}`} style={tintVars(tint)}>
      <div className="ticket-main">
        <span className="ticket-mark" aria-hidden="true">
          <Icon name="people" size={17} />
        </span>
        <span className="ticket-text">
          <b>一起听</b>
          <small>{line}</small>
        </span>
        {inv.status === 'accepted' && (
          <span className="ticket-stamp mono" aria-hidden="true">
            入场
          </span>
        )}
      </div>
      {t && (
        <div className="ticket-track">
          <span className={`ticket-disc ${inv.status === 'pending' ? 'spin' : ''}`} aria-hidden="true">
            <Cover src={t.coverUrl ?? t.album?.coverUrl} alt="" size={64} />
          </span>
          <span>
            <b>{t.name}</b>
            <small>{t.artists.map((a) => a.name).join(' / ')}</small>
          </span>
        </div>
      )}
      <div className="ticket-foot" key={inv.status}>
        {canAnswer ? (
          <>
            <button className="btn solid sm" onClick={() => void act('accept')} disabled={!!busy}>
              {busy === 'accept' ? '正在进入…' : '加入'}
            </button>
            <button className="text-btn" onClick={() => void act('reject')} disabled={!!busy}>
              不了
            </button>
            <span className="ticket-until mono">{until(inv.expiresAt)}</span>
          </>
        ) : (
          <span className="ticket-status">
            {inv.status === 'pending' && <i className="ticket-pulse" aria-hidden="true" />}
            {status}
            {inv.status === 'pending' && <span className="ticket-until mono">{until(inv.expiresAt)}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

/** 邀请还剩多久：几分钟内有效 */
function until(iso: string) {
  const left = Date.parse(iso) - Date.now();
  if (!(left > 0)) return '';
  const min = Math.ceil(left / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)} 小时内有效` : `${min} 分钟内有效`;
}
