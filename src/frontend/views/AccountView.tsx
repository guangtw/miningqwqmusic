import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MemberCard } from '../components/MemberCard';
import { PasswordRules } from '../components/PasswordRules';
import { Empty, Loading } from '../components/States';
import { ApiError } from '../api';
import { authStore, changePassword, displayName, logout, logoutAll } from '../lib/account';
import { navigate, href } from '../lib/router';
import { avatarProblem, passwordProblem, removeAvatar, updateNickname, uploadAvatar } from '../lib/profile';
import { socialStore } from '../lib/friends';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';

const joined = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月入会`;
};

/** 连点两次才执行的危险按钮：第一次变成「再点一次…」，3 秒后复原 */
function useConfirm() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return { armed, arm: () => setArmed(true), reset: () => setArmed(false) };
}

function AvatarField() {
  const user = useStore(authStore, (s) => s.user)!;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'up' | 'rm' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const problem = avatarProblem(file);
    if (problem) return setError(problem);
    setError(null);
    setBusy('up');
    try {
      await uploadAvatar(file);
      toast('头像换好了。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const reset = async () => {
    setBusy('rm');
    setError(null);
    try {
      await removeAvatar();
      toast('换回默认头像了。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="acct-avatar-field">
      <button className={`acct-avatar ${busy === 'up' ? 'busy' : ''}`} onClick={() => input.current?.click()} aria-label="更换头像" disabled={!!busy}>
        <Avatar user={user} size={88} />
        <span className="acct-avatar-cover" aria-hidden="true">
          {busy === 'up' ? '上传中' : '更换'}
        </span>
      </button>
      <div className="acct-avatar-side">
        <div className="field-inline">
          <button className="btn sm" onClick={() => input.current?.click()} disabled={!!busy}>
            {busy === 'up' ? '上传中…' : '上传新头像'}
          </button>
          {user.avatarUrl && (
            <button className="text-btn" onClick={reset} disabled={!!busy}>
              {busy === 'rm' ? '恢复中…' : '恢复默认'}
            </button>
          )}
        </div>
        <p className="help">PNG、JPG、WebP 或 GIF，5MB 以内。会居中裁成正方形，GIF 保留动图。</p>
        {error && <p className="field-error">{error}</p>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

function NicknameField() {
  const user = useStore(authStore, (s) => s.user)!;
  const [name, setName] = useState(user.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(user.nickname ?? ''), [user.nickname]);
  const dirty = name.trim() !== (user.nickname ?? '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('昵称不能空着。');
    if (n.length > 64) return setError('昵称最多 64 个字。');
    setBusy(true);
    setError(null);
    try {
      await updateNickname(n);
      toast('昵称改好了。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="acct-inline" onSubmit={save} noValidate>
      <input
        className="acct-input"
        value={name}
        maxLength={64}
        placeholder={user.email.split('@')[0]}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        aria-label="昵称"
        aria-invalid={!!error}
      />
      <button className="btn solid sm" disabled={busy || !dirty}>
        {busy ? '保存中…' : '保存'}
      </button>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}

function PasswordField() {
  const [open, setOpen] = useState(false);
  const [oldPw, setOld] = useState('');
  const [newPw, setNew] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: 'old' | 'new' | 'again'; text: string } | null>(null);

  const reset = () => {
    setOld('');
    setNew('');
    setAgain('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPw) return setError({ field: 'old', text: '填一下现在的密码。' });
    const problem = passwordProblem(newPw);
    if (problem) return setError({ field: 'new', text: problem });
    if (newPw === oldPw) return setError({ field: 'new', text: '新密码和现在的一样。' });
    if (again !== newPw) return setError({ field: 'again', text: '两次输入的新密码不一样。' });
    setBusy(true);
    setError(null);
    try {
      const r = await changePassword(oldPw, newPw);
      reset();
      setOpen(false);
      toast(r === 'relogged' ? '密码改好了，其他设备都已退出。' : '密码改好了，请用新密码重新登录。');
      if (r === 'signed-out') uiStore.set({ login: true });
    } catch (err) {
      // 原密码不对：账户服务返回 5202；原密码不满足新规则时会是 5101
      const code = err instanceof ApiError ? err.code : 0;
      setError(
        code === 5202 ? { field: 'old', text: '现在的密码不对。' } : code === 5101 ? { field: 'old', text: '现在的密码格式不对，确认一下。' } : { text: (err as Error).message },
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <button className="btn sm" onClick={() => setOpen(true)}>
          修改密码
        </button>
        <p className="help">改完以后其他设备上的登录都会失效，这台设备会自动用新密码登录。</p>
      </div>
    );
  }

  return (
    <form className="acct-pw" onSubmit={submit} noValidate>
      <label className="float">
        <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} placeholder=" " aria-invalid={error?.field === 'old'} autoFocus />
        <span>现在的密码</span>
      </label>
      {error?.field === 'old' && <p className="field-error">{error.text}</p>}
      <label className="float">
        <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNew(e.target.value)} placeholder=" " aria-invalid={error?.field === 'new'} />
        <span>新密码</span>
      </label>
      <PasswordRules value={newPw} />
      {error?.field === 'new' && <p className="field-error">{error.text}</p>}
      <label className="float">
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder=" " aria-invalid={error?.field === 'again'} />
        <span>再输一次新密码</span>
      </label>
      {error?.field === 'again' && <p className="field-error">{error.text}</p>}
      {error && !error.field && <p className="field-error">{error.text}</p>}
      <div className="field-inline">
        <button className="btn solid sm" disabled={busy}>
          {busy ? '修改中…' : '确认修改'}
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          取消
        </button>
      </div>
    </form>
  );
}

function SessionsField() {
  const all = useConfirm();
  const [busy, setBusy] = useState(false);
  const outAll = async () => {
    if (!all.armed) return all.arm();
    setBusy(true);
    try {
      await logoutAll();
      toast('所有设备都已退出。');
      navigate(href.home());
    } catch (e) {
      toast((e as Error).message);
    } finally {
      all.reset();
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="field-inline">
        <button className="btn sm" onClick={() => void logout()}>
          退出登录
        </button>
        <button className={`btn sm ${all.armed ? 'danger' : ''}`} onClick={() => void outAll()} disabled={busy} aria-live="polite">
          {busy ? '退出中…' : all.armed ? '再点一次，全部退出' : '退出所有设备'}
        </button>
      </div>
      <p className="help">手机或别人的电脑上忘了退出，就用「退出所有设备」，包括这台在内的登录都会立刻失效。</p>
    </div>
  );
}

function FriendsField() {
  const friends = useStore(socialStore, (s) => s.friends.length);
  const incoming = useStore(socialStore, (s) => s.requests.incoming.length);
  return (
    <div>
      <div className="field-inline">
        <a className="btn sm" href={href.friends()}>
          <Icon name="people" size={16} /> 管理好友
        </a>
        <span className="muted small">
          {friends} 位好友
          {incoming > 0 && <span className="accent"> · {incoming} 条请求待处理</span>}
        </span>
      </div>
      <p className="help">加了好友就能互相邀请进房间一起听。房间在播放栏右边的「一起听」里开。</p>
    </div>
  );
}

/** 个人中心：头像、昵称、会员卡、好友、密码、登录设备 */
export function AccountView() {
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);

  if (status === 'checking') {
    return (
      <div className="page">
        <Loading />
      </div>
    );
  }
  if (status !== 'authenticated' || !user) {
    return (
      <div className="page">
        <Empty title={status === 'unavailable' ? '账户服务没有开启' : '还没登录'}>
          {status === 'guest' && (
            <>
              <p className="muted">登录后收藏、歌单和会员卡会在设备之间同步。</p>
              <button className="btn" onClick={() => uiStore.set({ login: true })} style={{ marginTop: 18 }}>
                登录同步
              </button>
            </>
          )}
        </Empty>
      </div>
    );
  }

  const fields: [string, React.ReactNode][] = [
    ['头像', <AvatarField key="a" />],
    ['昵称', <NicknameField key="n" />],
    ['会员卡', <MemberCard key="m" />],
    ['好友', <FriendsField key="f" />],
    ['密码', <PasswordField key="p" />],
    ['登录设备', <SessionsField key="s" />],
  ];

  return (
    <div className="page">
      <header className="page-head acct-head reveal">
        <Avatar user={user} size={72} />
        <div>
          <div className="kicker">个人中心</div>
          <h1 className="page-title">{displayName(user)}</h1>
          <p className="muted small acct-sub">
            {user.email}
            {joined(user.createdAt) && <span className="faint"> · {joined(user.createdAt)}</span>}
            {user.role === 'admin' && (
              <a className="acct-admin" href={href.admin()}>
                <Icon name="card" size={15} /> 授权管理
              </a>
            )}
          </p>
        </div>
      </header>

      <div className="form acct-form">
        {fields.map(([label, node], i) => (
          <div key={label} className="field reveal" style={{ '--i': i + 1 } as React.CSSProperties}>
            <span className="label">{label}</span>
            {node}
          </div>
        ))}
      </div>
    </div>
  );
}
