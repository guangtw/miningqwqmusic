import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MemberCard } from '../components/MemberCard';
import { MemberApply } from '../components/MemberApply';
import { OtpInput, useSecondsLeft } from '../components/OtpInput';
import { PasswordRules } from '../components/PasswordRules';
import { Empty, Loading } from '../components/States';
import { ApiError } from '../api';
import { waitLabel } from '../api/http';
import { authStore, changePassword, changePasswordWithCode, displayName, logout, logoutAll, requestPasswordCode } from '../lib/account';
import { navigate, href, useRoute } from '../lib/router';
import { avatarProblem, passwordProblem, removeAvatar, updateNickname, uploadAvatar } from '../lib/profile';
import { socialStore } from '../lib/friends';
import { messagesStore, unreadTotal } from '../lib/messages';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';
import { SettingsPanel } from './SettingsView';

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

const PW_WAYS = [
  { key: 'old', label: '现在的密码' },
  { key: 'email', label: '邮箱验证码' },
] as const;
const PW_CODE_LENGTH = 6;

type PwError = { field?: 'old' | 'new' | 'again' | 'send' | 'code'; text: string; timed?: boolean };

/** 邮箱改密的失败怎么说。限流和繁忙带服务端给的等待时间，文案里的秒数由界面走 */
function emailPwError(err: unknown, field: 'send' | 'code'): PwError {
  const e = err instanceof ApiError ? err : null;
  // 5905 不区分错误、过期和错太多次
  if (e?.code === 5905) return { field: 'code', text: '验证码不对或已经失效。核对一下，不行就重新发一个。' };
  if (e?.code === 5900) return { field, text: '邮件服务暂时不可用，稍后再试，也可以先用现在的密码来改。' };
  if (e?.retryAfterSeconds && (e.status === 429 || e.code === 5910)) return { field, text: '尝试太频繁了。', timed: true };
  if (e?.retryAfterSeconds && e.code === 5914) return { field, text: '账户服务正忙。', timed: true };
  return { field: field === 'send' ? 'send' : undefined, text: (err as Error).message };
}

function PasswordField() {
  const email = useStore(authStore, (s) => s.user?.email);
  const [open, setOpen] = useState(false);
  const [way, setWay] = useState<'old' | 'email'>('old');
  const [oldPw, setOld] = useState('');
  const [newPw, setNew] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  // 收起表单时密码和验证码都清掉，这条记录留着：邮件里的码还能用，发送冷却也不能靠收起绕过
  const [challenge, setChallenge] = useState<{ id: string; resendAt: number; expiresAt: number; minutes: number } | null>(null);
  const [busy, setBusy] = useState<'send' | 'submit' | null>(null);
  const [error, setError] = useState<PwError | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<{ send: number | null; submit: number | null }>({ send: null, submit: null });
  const resendIn = useSecondsLeft(challenge?.resendAt ?? null);
  const sendBlocked = useSecondsLeft(blockedUntil.send);
  const submitBlocked = useSecondsLeft(blockedUntil.submit);

  const reset = () => {
    setOld('');
    setNew('');
    setAgain('');
    setCode('');
    setError(null);
  };

  const fail = (err: unknown, field: 'send' | 'code') => {
    const problem = emailPwError(err, field);
    if (problem.timed && err instanceof ApiError) {
      const until = Date.now() + err.retryAfterSeconds! * 1000;
      setBlockedUntil((b) => (field === 'send' ? { ...b, send: until } : { ...b, submit: until }));
    }
    setError(problem);
  };

  // 按钮还灰着的时候，得留着说明为什么灰
  const keepTimedError = () => setError((e) => (e?.timed ? e : null));

  const errorText = (e: PwError) => {
    if (!e.timed) return e.text;
    const left = e.field === 'send' ? sendBlocked : submitBlocked;
    return left > 0 ? `${e.text}请在 ${waitLabel(left)}后再试。` : '现在可以再试一次了。';
  };

  const send = async () => {
    if (busy || sendBlocked > 0 || resendIn > 0) return;
    setBusy('send');
    setError(null);
    try {
      const r = await requestPasswordCode();
      // 服务端时间和本机可能差几秒：按服务端给的间隔换算成本机时间点
      const skew = Date.now() - Date.parse(r.serverTime);
      const expiresAt = Date.parse(r.expiresAt);
      setChallenge({ id: r.challengeId, resendAt: Date.parse(r.resendAfter) + skew, expiresAt: expiresAt + skew, minutes: Math.round((expiresAt - Date.parse(r.serverTime)) / 60_000) });
      setCode('');
    } catch (err) {
      fail(err, 'send');
    } finally {
      setBusy(null);
    }
  };

  const submitWithCode = async () => {
    if (!challenge) return setError({ field: 'send', text: '先发一个验证码。' });
    if (code.length !== PW_CODE_LENGTH) return setError({ field: 'code', text: `验证码是 ${PW_CODE_LENGTH} 位数字。` });
    if (Date.now() > challenge.expiresAt) return setError({ field: 'code', text: '验证码已经过期了，重新发一个。' });
    const problem = passwordProblem(newPw);
    if (problem) return setError({ field: 'new', text: problem });
    if (again !== newPw) return setError({ field: 'again', text: '两次输入的新密码不一样。' });
    setBusy('submit');
    setError(null);
    try {
      await changePasswordWithCode(challenge.id, code, newPw);
      toast('密码已修改，请用新密码重新登录。');
      uiStore.set({ login: true });
    } catch (err) {
      fail(err, 'code');
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (way === 'email') return void submitWithCode();
    if (!oldPw) return setError({ field: 'old', text: '填一下现在的密码。' });
    const problem = passwordProblem(newPw);
    if (problem) return setError({ field: 'new', text: problem });
    if (newPw === oldPw) return setError({ field: 'new', text: '新密码和现在的一样。' });
    if (again !== newPw) return setError({ field: 'again', text: '两次输入的新密码不一样。' });
    setBusy('submit');
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
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <div>
        <button className="btn sm" onClick={() => setOpen(true)}>
          修改密码
        </button>
        <p className="help">改完以后其他设备上的登录都会失效。忘了现在的密码，也可以用邮箱验证码来改。</p>
      </div>
    );
  }

  return (
    <form className="acct-pw" onSubmit={submit} noValidate>
      <div className="seg seg-sm acct-pw-way" role="radiogroup" aria-label="验证方式">
        {PW_WAYS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={way === o.key}
            className={way === o.key ? 'on' : ''}
            disabled={busy === 'submit'}
            onClick={() => {
              setWay(o.key);
              keepTimedError();
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {way === 'old' ? (
        <>
          <label className="float acct-pw-swap">
            <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} placeholder=" " aria-invalid={error?.field === 'old'} autoFocus />
            <span>现在的密码</span>
          </label>
          {error?.field === 'old' && <p className="field-error">{error.text}</p>}
        </>
      ) : (
        <div className="acct-pw-code acct-pw-swap">
          <p className="login-code-note">
            <Icon name="mail" size={15} />
            {challenge ? (
              <span>
                验证码发往 {email} 了，可能要等一会儿，{challenge.minutes} 分钟内有效。 <span className="faint">没收到的话看看垃圾邮件；重发后旧的验证码就作废了。</span>
              </span>
            ) : (
              <span>验证码只会发到这个账号的邮箱：{email}</span>
            )}
          </p>
          <button type="button" className="btn sm acct-pw-send" onClick={() => void send()} disabled={!!busy || sendBlocked > 0 || resendIn > 0}>
            {busy === 'send' ? '发送中…' : resendIn > 0 ? `${resendIn} 秒后可重发` : challenge ? '重新发送' : '发送验证码'}
          </button>
          {error?.field === 'send' && <p className="field-error" role="alert">{errorText(error)}</p>}
          {challenge && (
            <div className="login-code-step">
              <OtpInput value={code} onChange={(v) => (setCode(v), keepTimedError())} length={PW_CODE_LENGTH} invalid={error?.field === 'code'} autoFocus />
              {error?.field === 'code' && <p className="field-error" role="alert">{errorText(error)}</p>}
            </div>
          )}
        </div>
      )}
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
      {error && !error.field && <p className="field-error" role="alert">{errorText(error)}</p>}
      <p className="help">{way === 'email' ? '改完这台设备要用新密码重新登录，其他设备上的登录也会陆续失效。' : '改完这台设备会自动用新密码登录，其他设备上的登录都会失效。'}</p>
      <div className="field-inline">
        <button className="btn solid sm" disabled={busy === 'submit' || (way === 'email' && submitBlocked > 0)}>
          {busy === 'submit' ? '修改中…' : '确认修改'}
        </button>
        <button
          type="button"
          className="text-btn"
          disabled={busy === 'submit'}
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
  const unread = useStore(messagesStore, unreadTotal);
  return (
    <div>
      <div className="field-inline">
        <a className="btn sm" href={href.friends()}>
          <Icon name="people" size={16} /> 打开
        </a>
        <span className="muted small">
          {friends} 位好友
          {unread > 0 && <span className="accent"> · {unread} 条私信未读</span>}
          {incoming > 0 && <span className="accent"> · {incoming} 条请求待处理</span>}
        </span>
      </div>
      <p className="help">加了好友就能互相邀请进房间一起听，也能发私信。房间在播放栏右边的「一起听」里开。</p>
    </div>
  );
}

/** 个人中心：头像、昵称、会员卡、好友、密码、登录设备 */
/** 个人中心的分页：账号 / 设置。手机上导航放不下「设置」，从右上角头像进来在这里切 */
function AcctTabs({ tab }: { tab: 'account' | 'settings' }) {
  return (
    <div className="acct-tabs seg" role="tablist" aria-label="个人中心">
      <a role="tab" href={href.account()} aria-selected={tab === 'account'} className={tab === 'account' ? 'on' : ''}>
        账号
      </a>
      <a role="tab" href={href.accountSettings()} aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''}>
        设置
      </a>
    </div>
  );
}

export function AccountView() {
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  const auth = useStore(authStore, (s) => s.playbackAuthorization);
  const tab = useRoute().query.get('tab') === 'settings' ? 'settings' : 'account';

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
        <header className="page-head acct-head reveal">
          <span className="who-guest acct-guest" aria-hidden="true">
            <Icon name="user" size={30} />
          </span>
          <div>
            <div className="kicker">个人中心</div>
            <h1 className="page-title">{status === 'unavailable' ? '账户服务没有开启' : '还没登录'}</h1>
            <p className="muted small acct-sub">
              {status === 'unavailable' ? '收藏只保存在这台设备上。' : '登录后收藏、歌单和会员卡会在设备之间同步。'}
            </p>
          </div>
        </header>
        <AcctTabs tab={tab} />
        {tab === 'settings' ? (
          <SettingsPanel />
        ) : (
          status === 'guest' && (
            <div className="acct-login reveal">
              <button className="btn" onClick={() => uiStore.set({ login: true })}>
                登录同步
              </button>
              <p className="help">注册时可以顺手填会员邀请码。</p>
            </div>
          )
        )}
      </div>
    );
  }

  const permanent = !!auth?.enabled && auth.membershipKind === 'permanent';
  const fields: [string, React.ReactNode][] = [
    ['头像', <AvatarField key="a" />],
    ['昵称', <NicknameField key="n" />],
    ['会员卡', <MemberCard key="m" />],
    // 永久会员用不着排队
    ...(permanent ? [] : ([['会员申请', <MemberApply key="ap" />]] as [string, React.ReactNode][])),
    ['好友和私信', <FriendsField key="f" />],
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
                <Icon name="card" size={15} /> 会员管理
              </a>
            )}
          </p>
        </div>
      </header>
      <AcctTabs tab={tab} />

      {tab === 'settings' ? (
        <SettingsPanel />
      ) : (
        <div className="form acct-form">
          {fields.map(([label, node], i) => (
            <div key={label} className="field reveal" style={{ '--i': i + 1 } as React.CSSProperties}>
              <span className="label">{label}</span>
              {node}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
