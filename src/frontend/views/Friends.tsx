import { useEffect, useState } from 'react';
import type { FriendRelationStatus, FriendSearchResult, FriendSummary } from '@/src/types/account';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Empty, Loading } from '../components/States';
import { authStore, displayName } from '../lib/account';
import { answerFriendRequest, maskEmail, refreshSocial, removeFriend, searchUsers, sendFriendRequest, socialStore } from '../lib/friends';
import { inviteFriend, listenStore } from '../lib/listen';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';

const sinceText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月成为好友`;
};

async function attempt(work: () => Promise<unknown>, done?: string) {
  try {
    await work();
    if (done) toast(done);
  } catch (e) {
    toast((e as Error).message);
  }
}

/** 搜人：昵称或邮箱，300ms 防抖，旧请求直接取消 */
function FindPeople() {
  const incoming = useStore(socialStore, (s) => s.requests.incoming);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FriendSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  // 刚在这里操作过的人：不等重新搜索，直接改按钮
  const [changed, setChanged] = useState<Record<string, FriendRelationStatus>>({});

  useEffect(() => {
    const kw = q.trim();
    if (!kw) return setResults(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      searchUsers(kw, ctrl.signal)
        .then(setResults, (e) => !ctrl.signal.aborted && toast((e as Error).message))
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const mark = (id: string, status: FriendRelationStatus) => setChanged((x) => ({ ...x, [id]: status }));
  const action = (r: FriendSearchResult) => {
    const name = displayName(r.user);
    const status = changed[r.user.id] ?? r.relationStatus;
    if (status === 'self') return <span className="faint small">这是你</span>;
    if (status === 'friend') return <span className="faint small">已是好友</span>;
    if (status === 'outgoing_pending') return <span className="faint small">等对方通过</span>;
    if (status === 'incoming_pending') {
      const req = incoming.find((x) => x.requester.id === r.user.id);
      return (
        <button
          className="btn solid sm"
          onClick={() =>
            req &&
            void attempt(async () => {
              await answerFriendRequest(req.id, 'accept');
              mark(r.user.id, 'friend');
            }, `和 ${name} 成为好友了。`)
          }
          disabled={!req}
        >
          通过请求
        </button>
      );
    }
    return (
      <button
        className="btn sm"
        onClick={() =>
          void attempt(async () => {
            const req = await sendFriendRequest(r.user.id);
            // 对方先加过你的话，后端会直接通过
            mark(r.user.id, req.status === 'accepted' ? 'friend' : 'outgoing_pending');
          }, `好友请求发给 ${name} 了。`)
        }
      >
        <Icon name="userAdd" size={16} /> 加好友
      </button>
    );
  };

  return (
    <section className="section s-section">
      <div className="section-head s-head">
        <h2>找人</h2>
      </div>
      <label className="people-search">
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜昵称或邮箱" maxLength={80} aria-label="搜昵称或邮箱" />
      </label>
      {loading && !results && <Loading rows={2} />}
      {results && results.length === 0 && <p className="muted small people-empty">没找到「{q.trim()}」。对方得先在这里注册过。</p>}
      {results && results.length > 0 && (
        <div className="people">
          {results.map((r) => (
            <div key={r.user.id} className="person">
              <Avatar user={r.user} size={40} />
              <span className="person-text">
                <b>{displayName(r.user)}</b>
                <small className="mono">{maskEmail(r.user.email)}</small>
              </span>
              {action(r)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Requests() {
  const { incoming, outgoing } = useStore(socialStore, (s) => s.requests);
  if (!incoming.length && !outgoing.length) return null;
  return (
    <section className="section s-section">
      <div className="section-head s-head">
        <h2>好友请求</h2>
        {incoming.length > 0 && <span className="mono s-count accent">{incoming.length} 条待处理</span>}
      </div>
      <div className="people">
        {incoming.map((r) => (
          <div key={r.id} className="person">
            <Avatar user={r.requester} size={40} />
            <span className="person-text">
              <b>{displayName(r.requester)}</b>
              <small>想加你为好友</small>
            </span>
            <button className="btn solid sm" onClick={() => void attempt(() => answerFriendRequest(r.id, 'accept'), `和 ${displayName(r.requester)} 成为好友了。`)}>
              通过
            </button>
            <button className="text-btn" onClick={() => void attempt(() => answerFriendRequest(r.id, 'reject'))}>
              忽略
            </button>
          </div>
        ))}
        {outgoing.map((r) => (
          <div key={r.id} className="person">
            <Avatar user={r.addressee} size={40} />
            <span className="person-text">
              <b>{displayName(r.addressee)}</b>
              <small>等对方通过</small>
            </span>
            <button className="text-btn" onClick={() => void attempt(() => answerFriendRequest(r.id, 'cancel'), '撤回了。')}>
              撤回
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function FriendRow({ f }: { f: FriendSummary }) {
  const inRoom = useStore(listenStore, (s) => s.room?.members.some((m) => m.user.id === f.user.id) ?? false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const name = displayName(f.user);

  return (
    <div className="person">
      <Avatar user={f.user} size={40} />
      <span className="person-text">
        <b>{name}</b>
        <small>{sinceText(f.since)}</small>
      </span>
      {inRoom ? (
        <span className="faint small">在房间里</span>
      ) : (
        <button
          className="btn sm"
          onClick={() =>
            void attempt(async () => {
              await inviteFriend(f.user.id);
              uiStore.set({ listen: true });
            }, `邀请发给 ${name} 了。`)
          }
        >
          <Icon name="people" size={16} /> 一起听
        </button>
      )}
      <button
        className={`text-btn ${armed ? 'danger' : ''}`}
        onClick={() => {
          if (!armed) return setArmed(true);
          setArmed(false);
          void attempt(() => removeFriend(f.user.id), `和 ${name} 不再是好友了。`);
        }}
      >
        {armed ? '再点一次删除' : '删除'}
      </button>
    </div>
  );
}

export function FriendsView() {
  const status = useStore(authStore, (s) => s.status);
  const friends = useStore(socialStore, (s) => s.friends);
  const loaded = useStore(socialStore, (s) => s.loaded);

  useEffect(() => {
    if (status === 'authenticated') void refreshSocial();
  }, [status]);

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
        <Empty title={status === 'unavailable' ? '账户服务没有开启' : '登录后才能加好友'}>
          {status === 'guest' && (
            <button className="btn" onClick={() => uiStore.set({ login: true })} style={{ marginTop: 18 }}>
              登录
            </button>
          )}
        </Empty>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head reveal">
        <div className="kicker">好友</div>
        <h1 className="page-title">一起听歌的人</h1>
        <p className="muted acct-sub">加了好友就能互相邀请进房间，一边放一边听。</p>
      </header>
      <FindPeople />
      <Requests />
      <section className="section s-section">
        <div className="section-head s-head">
          <h2>我的好友</h2>
          {friends.length > 0 && <span className="mono faint s-count">{friends.length} 位</span>}
        </div>
        {!loaded && <Loading rows={3} />}
        {loaded && friends.length === 0 && <p className="muted">还没有好友。在上面搜一下朋友的昵称或邮箱。</p>}
        <div className="people">
          {friends.map((f) => (
            <FriendRow key={f.user.id} f={f} />
          ))}
        </div>
      </section>
    </div>
  );
}
