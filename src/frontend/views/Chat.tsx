import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DirectConversationDto, DirectMessageDto, MessagePeer } from '@/src/types/social';
import { ApiError } from '../api/http';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { InviteTicket, MusicCard } from '../components/MusicCard';
import { Empty, Loading } from '../components/States';
import { authStore } from '../lib/account';
import { refreshSocial, sendFriendRequest, socialStore } from '../lib/friends';
import { inviteFriend, listenStore } from '../lib/listen';
import { cardOf, discardOutgoing, loadOlder, markRead, MESSAGE_MAX, messagesStore, openThread, resend, sendMessage, type Outgoing, type Thread } from '../lib/messages';
import { useMedia } from '../lib/motion';
import { motionEnabled } from '../lib/settings';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';

export const peerName = (peer: Pick<MessagePeer, 'nickname'>) => peer.nickname || '没起名字的人';

/** 两条消息隔多久算一段新对话，中间插一行时间 */
const GAP_MS = 60 * 60_000;
/** 同一个人隔多久以内的消息挤成一组 */
const GROUP_MS = 3 * 60_000;
/** 离底部多近算「在看最新的」：来新消息时跟着滚下去 */
const NEAR_BOTTOM = 160;

const pad = (n: number) => String(n).padStart(2, '0');

/** 时间分隔线：今天 14:32 / 昨天 09:10 / 11 月 3 日 14:32 / 2025 年 11 月 3 日 14:32 */
export function stampText(iso: string, now = new Date()) {
  const d = new Date(iso);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
}

type Row =
  | { kind: 'stamp'; key: string; text: string }
  | { kind: 'msg'; key: string; m: DirectMessageDto; mine: boolean; first: boolean; last: boolean }
  | { kind: 'out'; key: string; o: Outgoing; first: boolean; last: boolean };

/** 消息 + 待发 → 一行行：按时间插分隔线，同一个人挨着发的并成一组（组内只有最后一个气泡带尖角） */
function buildRows(thread: Thread, me: string | undefined): Row[] {
  const rows: Row[] = [];
  let prev = null as { at: number; mine: boolean } | null;
  const push = (at: number, mine: boolean, row: Row & { first: boolean }) => {
    if (!prev || at - prev.at > GAP_MS) rows.push({ kind: 'stamp', key: `t-${row.key}`, text: stampText(new Date(at).toISOString()) });
    const joined = !!prev && prev.mine === mine && at - prev.at < GROUP_MS && rows[rows.length - 1]?.kind !== 'stamp';
    row.first = !joined;
    if (joined) (rows[rows.length - 1] as Extract<Row, { last: boolean }>).last = false;
    rows.push(row);
    prev = { at, mine };
  };
  for (const m of thread.messages) {
    const mine = m.senderUserId === me;
    // 用 clientMessageId 当 key：待发的气泡确认后还是同一个元素，不会重新入场
    push(Date.parse(m.createdAt), mine, { kind: 'msg', key: m.clientMessageId || m.id, m, mine, first: true, last: true });
  }
  const now = Date.now();
  for (const o of thread.outbox) push(Math.max(now, (prev as { at: number } | null)?.at ?? 0), true, { kind: 'out', key: o.clientMessageId, o, first: true, last: true });
  return rows;
}

/** 草稿按人存在内存里：切走再回来还在 */
const drafts = new Map<string, string>();

export function ChatView({ peerId }: { peerId: string }) {
  const status = useStore(authStore, (s) => s.status);
  const me = useStore(authStore, (s) => s.user?.id);
  const conversation = useStore(messagesStore, (s) => s.conversations[peerId]);
  const thread = useStore(messagesStore, (s) => s.threads[peerId]);
  const friend = useStore(socialStore, (s) => s.friends.find((f) => f.user.id === peerId));
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' || !me || me === peerId) return;
    setMissing(false);
    openThread(peerId).catch((e) => {
      if (e instanceof ApiError && e.code === 5802) setMissing(true);
      else toast((e as Error).message);
    });
    // 回到前台：补一下离开期间的消息（事件流断过也不怕）
    const back = () => document.visibilityState === 'visible' && void openThread(peerId).catch(() => undefined);
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [status, me, peerId]);

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
        <Empty title={status === 'unavailable' ? '账户服务没有开启' : '登录后才能发私信'}>
          {status === 'guest' && (
            <button className="btn" onClick={() => uiStore.set({ login: true })} style={{ marginTop: 18 }}>
              登录
            </button>
          )}
        </Empty>
      </div>
    );
  }
  if (me === peerId || missing) {
    return (
      <div className="page">
        <Empty title={missing ? '找不到这个人' : '这是你自己'}>
          <p className="muted">{missing ? '对方可能已经注销了账号。' : '私信只能发给别人。'}</p>
          <a className="btn" href={href.friends()} style={{ marginTop: 18 }}>
            回好友
          </a>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page chat-page">
      <ChatHead peerId={peerId} conversation={conversation} friendSince={friend?.since} />
      {thread?.loaded && conversation ? (
        <ChatLog peerId={peerId} thread={thread} conversation={conversation} me={me} />
      ) : thread?.error ? (
        <p className="muted chat-error">
          {thread.error}{' '}
          <button className="text-btn" onClick={() => void openThread(peerId).catch(() => undefined)}>
            重试
          </button>
        </p>
      ) : (
        <div className="chat-log">
          <Loading rows={3} />
        </div>
      )}
      {conversation && <Composer peerId={peerId} conversation={conversation} theirs={thread?.messages.some((m) => m.senderUserId === peerId) ?? false} />}
    </div>
  );
}

function ChatHead({ peerId, conversation, friendSince }: { peerId: string; conversation?: DirectConversationDto; friendSince?: string }) {
  const outgoing = useStore(socialStore, (s) => s.requests.outgoing.some((r) => r.addressee.id === peerId));
  const [asked, setAsked] = useState(false);
  const peer = conversation?.peer;
  const isFriend = conversation?.sendPolicy.relationship === 'friend' || !!friendSince;
  const since = friendSince ? new Date(friendSince) : null;
  const together = useStore(listenStore, (s) => s.room?.members.some((m) => m.user.id === peerId) ?? false);
  const [inviting, setInviting] = useState(false);
  // 邀请会自动变成聊天里的一张入场券，不用另外发文字
  const invite = () => {
    setInviting(true);
    inviteFriend(peerId)
      .catch((e) => toast((e as Error).message))
      .finally(() => setInviting(false));
  };

  return (
    <header className="chat-head">
      <a className="chat-back" href={href.friends()} aria-label="回好友">
        <Icon name="left" size={18} />
        <span>好友</span>
      </a>
      <div className="chat-who">
        {peer ? <Avatar user={peer} size={52} /> : <span className="avatar chat-avatar-skel" style={{ width: 52, height: 52 }} />}
        <div className="chat-who-text">
          <h1 className="chat-name">{peer ? peerName(peer) : ' '}</h1>
          {conversation && (
            <p className="chat-rel">
              {isFriend ? (
                <>好友{since && !Number.isNaN(since.getTime()) ? `，${since.getFullYear()} 年 ${since.getMonth() + 1} 月加的` : ''}</>
              ) : outgoing || asked ? (
                <>还不是好友，等对方通过请求</>
              ) : (
                <>
                  还不是好友
                  <button
                    className="text-btn chat-add"
                    onClick={() =>
                      void sendFriendRequest(peerId).then(
                        (r) => {
                          setAsked(true);
                          toast(r.status === 'accepted' ? '你们成为好友了。' : '好友请求发出去了。');
                          void refreshSocial();
                        },
                        (e) => toast((e as Error).message),
                      )
                    }
                  >
                    <Icon name="userAdd" size={15} /> 加好友
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
      {isFriend && (
        <button className="btn sm chat-listen" onClick={invite} disabled={inviting || together} aria-label={together ? '你们在一起听' : '邀请一起听'}>
          <Icon name="people" size={16} /> <span className="btn-label">{together ? '在一起听' : inviting ? '邀请中…' : '一起听'}</span>
        </button>
      )}
    </header>
  );
}

const mainEl = () => document.querySelector<HTMLElement>('.main');

function ChatLog({ peerId, thread, conversation, me }: { peerId: string; thread: Thread; conversation: DirectConversationDto; me?: string }) {
  const rows = useMemo(() => buildRows(thread, me), [thread, me]);
  const logRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const lastKey = rows.length ? rows[rows.length - 1].key : '';
  const firstKey = thread.messages[0]?.id ?? '';
  const [fresh, setFresh] = useState(0);
  // 加载更早消息前记下滚动位置，加载完把新长出来的高度补回去，画面不跳
  const anchor = useRef<{ top: number; height: number } | null>(null);
  const placed = useRef(false);
  const wasNearBottom = useRef(true);

  // 每次渲染前记一下：用户是不是正停在底部
  const main = mainEl();
  if (main) wasNearBottom.current = main.scrollHeight - main.scrollTop - main.clientHeight < NEAR_BOTTOM;

  useLayoutEffect(() => {
    const el = mainEl();
    if (!el) return;
    if (!placed.current) {
      placed.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
    }
  }, [firstKey]);

  // 来了新的一条：自己发的、或者本来就停在底部，跟着滚下去；不然在输入框上面冒个「新消息」
  const lastRow = rows[rows.length - 1];
  const lastMine = lastRow && (lastRow.kind === 'out' || (lastRow.kind === 'msg' && lastRow.mine));
  useLayoutEffect(() => {
    const el = mainEl();
    if (!el || !placed.current) return;
    if (lastMine || wasNearBottom.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setFresh(0);
    } else setFresh((n) => n + 1);
  }, [lastKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = mainEl();
    if (!el || !fresh) return;
    const onScroll = () => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM && setFresh(0);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [fresh]);

  // 顶上的哨兵露出来：翻更早的
  useEffect(() => {
    const el = topRef.current;
    if (!el || !thread.hasOlder) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const m = mainEl();
        if (!e.isIntersecting || !m || !placed.current) return;
        anchor.current = { top: m.scrollTop, height: m.scrollHeight };
        void loadOlder(peerId).catch((err) => toast((err as Error).message));
      },
      { root: mainEl(), rootMargin: '240px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [peerId, thread.hasOlder, firstKey]);

  // 已读：屏幕上真的露出来、页面也在前台，才把位置报上去
  const seen = useRef(new Map<string, DirectMessageDto>());
  const byId = useMemo(() => new Map(thread.messages.map((m) => [m.id, m])), [thread.messages]);
  const report = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    let best: DirectMessageDto | undefined;
    for (const m of seen.current.values()) if (!best || m.sequence > best.sequence) best = m;
    if (best) markRead(peerId, best);
  }, [peerId]);
  useEffect(() => {
    const box = logRef.current;
    if (!box) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.id!;
          const m = byId.get(id);
          if (e.isIntersecting && m) seen.current.set(id, m);
          else seen.current.delete(id);
        }
        report();
      },
      { root: mainEl(), threshold: 0.6 },
    );
    box.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => io.observe(el));
    document.addEventListener('visibilitychange', report);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', report);
    };
  }, [byId, report]);

  // 新到的气泡弹进来：从末尾往前找还没露过面的，碰到露过面的就停（往上翻出来的旧消息、首屏都不演）
  useLayoutEffect(() => {
    const box = logRef.current;
    if (!box) return;
    const els = box.querySelectorAll<HTMLElement>('.msg');
    const animate = !!box.dataset.ready && motionEnabled();
    for (let i = els.length - 1; i >= 0 && !els[i].dataset.shown; i--) {
      const el = els[i];
      el.dataset.shown = '1';
      if (!animate) continue;
      const mine = el.classList.contains('mine');
      // 附言和卡片一前一后弹进来
      el.querySelectorAll('.bubble, .mcard, .ticket').forEach((part, k) =>
        part.animate(
          [
            { opacity: 0, transform: `translate(${mine ? 10 : -10}px, 16px) scale(0.9)` },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 520, delay: k * 70, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' },
        ),
      );
    }
    els.forEach((el) => (el.dataset.shown = '1'));
    box.dataset.ready = '1';
  });

  // 「已读 / 已发送」只挂在自己最后一条已送达的消息下面
  const lastOwn = [...thread.messages].reverse().find((m) => m.senderUserId === me);
  const receipt = lastOwn && !thread.outbox.length ? lastOwn.id : null;
  const read = !!lastOwn && lastOwn.sequence <= conversation.peerLastReadSequence;

  return (
    <div className="chat-log" ref={logRef} role="log" aria-label={`和 ${peerName(conversation.peer)} 的私信`}>
      {thread.hasOlder ? (
        <div ref={topRef} className="chat-older mono">
          {thread.loadingOlder ? '往前翻…' : ''}
        </div>
      ) : (
        <ChatStart peer={conversation.peer} conversation={conversation} empty={!thread.messages.length && !thread.outbox.length} />
      )}
      {rows.map((r) =>
        r.kind === 'stamp' ? (
          <div key={r.key} className="chat-stamp mono">
            {r.text}
          </div>
        ) : r.kind === 'msg' ? (
          <Bubble
            key={r.key}
            m={r.m}
            mine={r.mine}
            me={me}
            peerId={peerId}
            peer={conversation.peer}
            first={r.first}
            last={r.last}
            receipt={r.m.id === receipt ? (read ? 'read' : 'sent') : null}
          />
        ) : (
          <Pending key={r.key} peerId={peerId} o={r.o} first={r.first} last={r.last} peer={conversation.peer} />
        ),
      )}
      {fresh > 0 && (
        <button className="chat-fresh" onClick={() => mainEl()?.scrollTo({ top: mainEl()!.scrollHeight, behavior: 'smooth' })}>
          <Icon name="down" size={15} /> {fresh > 1 ? `${fresh} 条新消息` : '新消息'}
        </button>
      )}
    </div>
  );
}

function ChatStart({ peer, conversation, empty }: { peer: MessagePeer; conversation: DirectConversationDto; empty: boolean }) {
  const stranger = conversation.sendPolicy.relationship === 'stranger' && !conversation.sendPolicy.hasMutualMessages;
  return (
    <div className={`chat-start ${empty ? 'is-empty' : ''}`}>
      {empty && <Avatar user={peer} size={72} />}
      <p>{empty ? `给 ${peerName(peer)} 写第一句话` : '这是你们最早的消息'}</p>
      {empty && stranger && <small>你们还不是好友：对方回复之前，你最多能发 3 条。</small>}
    </div>
  );
}

/** 卡片消息：附言是一个普通气泡，卡片跟在它下面；一起听邀请是一张入场券 */
function CardBody({ c, peerId, messageId, me, peer }: { c: NonNullable<ReturnType<typeof cardOf>>; peerId: string; messageId?: string; me?: string; peer: MessagePeer }) {
  if (c.kind === 'listen_invite') {
    return messageId ? <InviteTicket inv={c.invitation} me={me} messageId={messageId} peerName={peerName(peer)} /> : null;
  }
  return (
    <>
      {c.caption && <p className="bubble">{c.caption}</p>}
      <MusicCard c={c} peerId={peerId} messageId={messageId} />
    </>
  );
}

const Bubble = memo(function Bubble({
  m,
  mine,
  me,
  peerId,
  peer,
  first,
  last,
  receipt,
}: {
  m: DirectMessageDto;
  mine: boolean;
  me?: string;
  peerId: string;
  peer: MessagePeer;
  first: boolean;
  last: boolean;
  receipt: 'read' | 'sent' | null;
}) {
  const at = new Date(m.createdAt);
  const card = cardOf(m);
  return (
    <div className={`msg ${mine ? 'mine' : 'theirs'} ${first ? 'first' : ''} ${last ? 'last' : ''} ${card ? 'has-card' : ''}`} data-id={m.id}>
      {card ? (
        <CardBody c={card} peerId={peerId} messageId={m.id} me={me} peer={peer} />
      ) : (
        <p className="bubble" title={`${pad(at.getHours())}:${pad(at.getMinutes())}`}>
          {m.text}
        </p>
      )}
      {receipt && (
        <span className={`receipt mono ${receipt}`} key={receipt}>
          {receipt === 'read' ? '已读' : '已发送'}
        </span>
      )}
    </div>
  );
});

function Pending({ peerId, o, first, last, peer }: { peerId: string; o: Outgoing; first: boolean; last: boolean; peer: MessagePeer }) {
  return (
    <div className={`msg mine pending ${o.status} ${first ? 'first' : ''} ${last ? 'last' : ''} ${o.preview ? 'has-card' : ''}`}>
      {o.preview ? <CardBody c={o.preview} peerId={peerId} peer={peer} /> : <p className="bubble">{o.text}</p>}
      {o.status === 'sending' ? (
        <span className="receipt mono">
          <span className="sending-disc" aria-hidden="true" />
          发送中
        </span>
      ) : (
        <span className="receipt mono failed">
          {o.error ?? '没发出去'}
          {!o.retryAt && (
            <button className="text-btn" onClick={() => void resend(peerId, o)}>
              重发
            </button>
          )}
          <button className="text-btn" onClick={() => discardOutgoing(peerId, o.clientMessageId)}>
            不发了
          </button>
        </span>
      )}
    </div>
  );
}

function Composer({ peerId, conversation, theirs }: { peerId: string; conversation: DirectConversationDto; theirs: boolean }) {
  const [text, setText] = useState(() => drafts.get(peerId) ?? '');
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const touch = useMedia('(pointer: coarse)');
  const policy = conversation.sendPolicy;
  const stranger = policy.relationship === 'stranger' && !policy.hasMutualMessages;
  const left = policy.remainingBeforeReply ?? 3;
  const canSend = policy.canSend;
  const body = text.trim();
  const ready = !!body && body.length <= MESSAGE_MAX && canSend;
  const name = peerName(conversation.peer);

  useEffect(() => {
    drafts.set(peerId, text);
  }, [peerId, text]);

  // 输入框跟着内容长高，最多五行
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const send = () => {
    if (!ready) return;
    setText('');
    void sendMessage(peerId, body).then((r) => {
      if (r !== 'limit') return;
      // 额度刚好被别的设备用完：文字还给输入框
      setText((cur) => cur || body);
      toast('对方回复之前，最多只能发 3 条。');
    });
    if (!touch) boxRef.current?.focus();
  };

  return (
    <form
      className="chat-compose"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {stranger && (
        <div className={`chat-quota ${canSend ? '' : 'spent'}`} aria-live="polite">
          {theirs ? (
            <span>回一条，就不再限制条数。</span>
          ) : (
            <>
              <span className="quota-pips" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <i key={i} className={i < left ? 'on' : ''} />
                ))}
              </span>
              <span>{canSend ? `对方回复之前，你还能发 ${left} 条` : '已经发了 3 条，等对方回复就能接着聊'}</span>
            </>
          )}
        </div>
      )}
      <div className={`chat-box ${canSend ? '' : 'locked'}`}>
        <textarea
          ref={boxRef}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX}
          disabled={!canSend}
          placeholder={canSend ? `写给 ${name}` : '等对方回复'}
          aria-label={`写给 ${name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 输入法选词时的回车不算；手机上回车换行，用按钮发
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229 || touch) return;
            e.preventDefault();
            send();
          }}
        />
        {text.length > MESSAGE_MAX - 200 && <span className="chat-count mono">{MESSAGE_MAX - text.length}</span>}
        <button type="submit" className={`chat-send ${ready ? 'ready' : ''}`} disabled={!ready} aria-label="发送">
          <Icon name="send" size={18} />
        </button>
      </div>
    </form>
  );
}
