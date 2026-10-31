import { useEffect, useState } from 'react';
import { coverOf } from '../api';
import { authStore, displayName } from '../lib/account';
import { socialStore } from '../lib/friends';
import { acceptInvite, createRoom, inviteFriend, joinRoom, leaveRoom, listenStore, rejectInvite } from '../lib/listen';
import { usePresence } from '../lib/motion';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { currentTrack, playerStore } from '../player/player';
import { uiStore } from '../player/ui';
import { Avatar } from './Avatar';
import { Cover } from './Cover';
import { Icon } from './Icon';

const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 10 ? '刚刚' : s < 60 ? `${s} 秒前` : `${Math.round(s / 60)} 分钟前`;
};

async function attempt(work: () => Promise<unknown>, done?: string) {
  try {
    await work();
    if (done) toast(done);
  } catch (e) {
    toast((e as Error).message);
  }
}

/** 没在房间里：开一个，或者输房间码进别人的 */
function Lobby() {
  const phase = useStore(listenStore, (s) => s.phase);
  const invites = useStore(socialStore, (s) => s.invites);
  const track = useStore(playerStore, (s) => currentTrack(s));
  const [code, setCode] = useState('');
  const busy = phase === 'busy';

  return (
    <div className="listen-lobby">
      <button className="listen-open" onClick={() => void attempt(createRoom, '房间开好了，把房间码发给朋友吧。')} disabled={busy}>
        <span className="listen-open-art">
          {track ? <Cover src={coverOf(track)} alt="" size={160} /> : <Icon name="people" />}
        </span>
        <span>
          <b>开一个房间</b>
          <small>{track ? `从《${track.name}》开始，队列一起带进去` : '先挑首歌再开也行，进来的人会跟着你放'}</small>
        </span>
      </button>

      <form
        className="listen-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length < 4) return toast('房间码是 6 位字母和数字。');
          void attempt(() => joinRoom(code), '进来了，正在跟上大家的进度。');
        }}
      >
        <label className="notes-label mono" htmlFor="listen-code">
          用房间码加入
        </label>
        <div className="listen-join-row">
          <input
            id="listen-code"
            className="listen-code-input mono"
            value={code}
            maxLength={16}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="ABC123"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn solid" disabled={busy || !code}>
            加入
          </button>
        </div>
      </form>

      {invites.length > 0 && (
        <div className="listen-block">
          <span className="notes-label mono">收到的邀请</span>
          {invites.map((inv) => (
            <div key={inv.id} className="person">
              <Avatar user={inv.inviter} size={36} />
              <span className="person-text">
                <b>{displayName(inv.inviter)}</b>
                <small>房间里有 {inv.memberCount} 人</small>
              </span>
              <button className="btn solid sm" onClick={() => void attempt(() => acceptInvite(inv.id))} disabled={busy}>
                加入
              </button>
              <button className="text-btn" onClick={() => void attempt(() => rejectInvite(inv.id))}>
                不了
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 在房间里：房间码、谁在、邀请好友、离开 */
function Room() {
  const room = useStore(listenStore, (s) => s.room)!;
  const phase = useStore(listenStore, (s) => s.phase);
  const last = useStore(listenStore, (s) => s.last);
  const friends = useStore(socialStore, (s) => s.friends);
  const meId = useStore(authStore, (s) => s.user?.id);
  const [invited, setInvited] = useState<Record<string, boolean>>({});
  const inRoom = new Set(room.members.map((m) => m.user.id));
  const outside = friends.filter((f) => !inRoom.has(f.user.id));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.inviteCode);
      toast('房间码复制好了。');
    } catch {
      toast(`房间码：${room.inviteCode}`);
    }
  };

  return (
    <div className="listen-room">
      <div className="listen-code">
        <span className="notes-label mono">房间码</span>
        <button className="listen-code-big mono" onClick={() => void copy()} title="点一下复制">
          {room.inviteCode.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
          <Icon name="copy" size={18} />
        </button>
        <p className="muted small">
          {phase === 'reconnecting' ? '连接断了，正在重连…' : '播放、暂停、切歌、拖进度，房间里每个人都会跟着变。'}
        </p>
        {last && (
          <p className="listen-last small">
            <b>{last.who}</b> {last.what} · <span className="faint">{ago(last.at)}</span>
          </p>
        )}
      </div>

      <div className="listen-block">
        <span className="notes-label mono">在听的 {room.members.length} 人</span>
        {room.members.map((m) => (
          <div key={m.user.id} className="person">
            <span className={`person-avatar ${m.online ? 'online' : ''}`}>
              <Avatar user={m.user} size={36} />
            </span>
            <span className="person-text">
              <b>
                {displayName(m.user)}
                {m.user.id === meId && <span className="faint">（我）</span>}
              </b>
              <small>{m.role === 'host' ? '房主' : m.online ? '在线' : '有一会儿没动静了'}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="listen-block">
        <span className="notes-label mono">邀请好友</span>
        {outside.length === 0 && (
          <p className="muted small">
            {friends.length ? '好友都在房间里了。' : '还没有好友。'}
            <a className="text-btn" href={href.friends()} onClick={() => uiStore.set({ listen: false })}>
              {' '}
              去加好友 →
            </a>
          </p>
        )}
        {outside.map((f) => (
          <div key={f.user.id} className="person">
            <Avatar user={f.user} size={36} />
            <span className="person-text">
              <b>{displayName(f.user)}</b>
            </span>
            <button
              className="btn sm"
              disabled={invited[f.user.id]}
              onClick={() =>
                void attempt(async () => {
                  await inviteFriend(f.user.id);
                  setInvited((x) => ({ ...x, [f.user.id]: true }));
                }, `邀请发给 ${displayName(f.user)} 了。`)
              }
            >
              {invited[f.user.id] ? '已邀请' : '邀请'}
            </button>
          </div>
        ))}
      </div>

      <button className="btn wide" onClick={() => void attempt(leaveRoom, '离开房间了，接下来自己听。')}>
        离开房间
      </button>
    </div>
  );
}

export function ListenDrawer() {
  const open = useStore(uiStore, (s) => s.listen);
  const { mounted, state } = usePresence(open, 320);
  const status = useStore(authStore, (s) => s.status);
  const room = useStore(listenStore, (s) => s.room);
  const close = () => uiStore.set({ listen: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;
  return (
    <>
      <div className="scrim" data-state={state} onClick={close} />
      <aside className="drawer listen-drawer" data-state={state} aria-label="一起听">
        <div className="drawer-head">
          <h2>一起听</h2>
          {room && <span className="listen-live mono">LIVE</span>}
          <button className="icon-btn" onClick={close} aria-label="关闭" style={{ marginLeft: 'auto' }}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-list listen-body">
          {status !== 'authenticated' ? (
            <div className="listen-lobby">
              <p className="muted">登录以后可以开房间和朋友一起听：谁按播放、切歌、拖进度，大家都跟着变。</p>
              {status === 'guest' && (
                <button className="btn solid" onClick={() => uiStore.set({ listen: false, login: true })}>
                  登录
                </button>
              )}
            </div>
          ) : room ? (
            <Room />
          ) : (
            <Lobby />
          )}
        </div>
      </aside>
    </>
  );
}

/** 右下角的邀请卡片：只显示最新一条，没在看抽屉的时候才出来 */
export function ListenInviteCard() {
  const invites = useStore(socialStore, (s) => s.invites);
  const drawer = useStore(uiStore, (s) => s.listen);
  const roomId = useStore(listenStore, (s) => s.room?.id);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const inv = invites.find((i) => !hidden[i.id] && i.roomId !== roomId);
  const { mounted, state } = usePresence(!!inv && !drawer, 260);
  const [shown, setShown] = useState(inv);
  useEffect(() => {
    if (inv) setShown(inv);
  }, [inv]);
  if (!mounted || !shown) return null;
  const dismiss = () => setHidden((h) => ({ ...h, [shown.id]: true }));

  return (
    <div className="invite-card" data-state={state} role="status">
      <Avatar user={shown.inviter} size={40} />
      <div className="invite-text">
        <b>{displayName(shown.inviter)} 邀请你一起听</b>
        <small className="mono">房间里有 {shown.memberCount} 人</small>
      </div>
      <div className="invite-actions">
        <button
          className="btn solid sm"
          onClick={() => {
            dismiss();
            void attempt(() => acceptInvite(shown.id), '进来了，正在跟上大家的进度。');
          }}
        >
          加入
        </button>
        <button
          className="text-btn"
          onClick={() => {
            dismiss();
            void rejectInvite(shown.id).catch(() => undefined);
          }}
        >
          不了
        </button>
      </div>
    </div>
  );
}
