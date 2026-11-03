import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountUser } from '@/src/types/account';
import type { MessagePeer } from '@/src/types/social';
import { authStore } from '../lib/account';
import { refreshSocial, socialStore } from '../lib/friends';
import { conversationList, messagesStore, refreshConversations } from '../lib/messages';
import { href } from '../lib/router';
import { previewOf, shareTo, type ShareTarget } from '../lib/share';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';
import { peerName } from '../views/Chat';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { MusicCard } from './MusicCard';
import { Shell } from './PlaylistDialogs';

const asPeer = (u: AccountUser): MessagePeer => ({
  id: u.id,
  nickname: u.nickname || u.email.split('@')[0],
  avatarUrl: u.avatarUrl ?? null,
  avatarFallbackText: u.avatarFallbackText ?? (u.nickname || u.email).slice(0, 1),
  avatarFallbackBg: u.avatarFallbackBg ?? '',
});

interface Person {
  peer: MessagePeer;
  friend: boolean;
  /** 陌生人额度用完了 */
  locked: boolean;
}

/**
 * 分享给好友：上面是卡片的样子（附言跟着输入实时变），中间挑一个人，下面写一句话。
 * 最近聊过的人排前面，然后是其余好友；还没回过你的陌生人额度用完了就灰掉。
 */
export function ShareDialog() {
  const live = useStore(uiStore, (s) => s.share);
  const last = useRef<ShareTarget | null>(live);
  if (live) last.current = live;
  const target = last.current;
  const friends = useStore(socialStore, (s) => s.friends);
  const conversations = useStore(messagesStore, (s) => s.conversations);
  const convs = useMemo(() => conversationList({ ...messagesStore.get(), conversations }), [conversations]);
  const me = useStore(authStore, (s) => s.user?.id);
  const [to, setTo] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; peer?: string } | null>(null);
  const close = () => uiStore.set({ share: null });

  useEffect(() => {
    if (!live) return;
    setTo(null);
    setCaption('');
    setQuery('');
    setError(null);
    setBusy(false);
    void refreshSocial();
    void refreshConversations().catch(() => undefined);
  }, [live]);

  const people = useMemo(() => {
    const out: Person[] = [];
    const seen = new Set<string>();
    const friendIds = new Set(friends.map((f) => f.user.id));
    for (const c of convs) {
      if (c.peer.id === me) continue;
      seen.add(c.peer.id);
      out.push({ peer: c.peer, friend: friendIds.has(c.peer.id) || c.sendPolicy.relationship === 'friend', locked: !c.sendPolicy.canSend });
    }
    const rest = friends
      .filter((f) => !seen.has(f.user.id))
      .map((f) => asPeer(f.user))
      .sort((a, b) => peerName(a).localeCompare(peerName(b), 'zh-CN'));
    for (const peer of rest) out.push({ peer, friend: true, locked: false });
    return out;
  }, [friends, convs, me]);

  const q = query.trim().toLowerCase();
  const shown = q ? people.filter((x) => peerName(x.peer).toLowerCase().includes(q)) : people;
  const picked = people.find((x) => x.peer.id === to);
  const preview = target ? previewOf(target, caption) : null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !picked || busy) return;
    setBusy(true);
    setError(null);
    const name = peerName(picked.peer);
    const r = await shareTo(picked.peer.id, target, caption);
    setBusy(false);
    if (r === 'sent') {
      toast(`分享给 ${name} 了。`);
      return close();
    }
    if (r === 'limit') return setError({ text: `${name} 还没回复你，最多只能先发 3 条。换一个人吧。` });
    const failed = messagesStore.get().threads[picked.peer.id]?.outbox.find((o) => o.status === 'failed');
    setError({ text: `没发出去：${failed?.error ?? '网络不太好'}`, peer: picked.peer.id });
  };

  return (
    <Shell open={!!live} onClose={close} labelledBy="share-title" className="share-dialog">
      <div className="kicker">分享</div>
      <h2 id="share-title">送给谁听</h2>
      {preview && preview.kind !== 'listen_invite' && (
        <div className="share-preview">
          {caption.trim() && <p className="bubble">{caption.trim()}</p>}
          <MusicCard c={preview} />
        </div>
      )}
      <form className="share-form" onSubmit={send}>
        {people.length > 6 && (
          <label className="share-search">
            <Icon name="search" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="找人" aria-label="按昵称找人" />
          </label>
        )}
        <div className="share-people" role="radiogroup" aria-label="分享给">
          {shown.map((x) => {
            const on = x.peer.id === to;
            return (
              <button
                type="button"
                key={x.peer.id}
                role="radio"
                aria-checked={on}
                disabled={x.locked}
                className={`share-person ${on ? 'on' : ''}`}
                onClick={() => {
                  setTo(on ? null : x.peer.id);
                  setError(null);
                }}
              >
                <Avatar user={x.peer} size={36} />
                <span className="share-person-text">
                  <b>{peerName(x.peer)}</b>
                  {!x.friend && <small>{x.locked ? '等对方回复' : '还不是好友'}</small>}
                </span>
                <span className="share-check" aria-hidden="true">
                  {on && <Icon name="check" size={15} />}
                </span>
              </button>
            );
          })}
          {!people.length && (
            <p className="muted small share-none">
              还没有好友。<a href={href.friends()} onClick={close}>去加几个</a>
            </p>
          )}
          {people.length > 0 && !shown.length && <p className="muted small share-none">没有叫这个名字的人。</p>}
        </div>
        <textarea
          className="share-caption"
          rows={2}
          maxLength={2000}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="附一句话（可以不写）"
          aria-label="附一句话"
        />
        {error && (
          <p className="field-error share-error">
            {error.text}
            {error.peer && (
              <a className="text-btn" href={href.chat(error.peer)} onClick={close}>
                去聊天里重发
              </a>
            )}
          </p>
        )}
        <button className="btn solid share-send" disabled={!picked || busy}>
          <Icon name="send" size={17} /> {busy ? '正在发…' : picked ? `发给 ${peerName(picked.peer)}` : '先选一个人'}
        </button>
      </form>
    </Shell>
  );
}
