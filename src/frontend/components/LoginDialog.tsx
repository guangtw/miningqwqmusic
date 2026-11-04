import { useEffect, useRef, useState } from 'react';
import { ApiError, waitLabel } from '../api/http';
import { emailLoginStatus, loginWithCode, login, register, requestLoginCode, type EmailLoginStatus } from '../lib/account';
import { redeemCode } from '../lib/membership';
import { usePresence } from '../lib/motion';
import { passwordProblem } from '../lib/profile';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';
import { Icon } from './Icon';
import { OtpInput, useSecondsLeft } from './OtpInput';
import { PasswordRules } from './PasswordRules';

type Mode = 'login' | 'register';

/** 登录 / 注册：对接 BFF 代理的账户服务（/api/account/auth/*） */
export function LoginDialog() {
  const open = useStore(uiStore, (s) => s.login);
  const { mounted, state } = usePresence(open, 220);
  const [mode, setMode] = useState<Mode>('login');
  // 登录页里切到「邮箱验证码」：给忘了密码的已有账号用
  const [viaCode, setViaCode] = useState(false);
  const [otp, setOtp] = useState<EmailLoginStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<{ field?: 'email' | 'password'; text: string; timed?: boolean; locked?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [cooldown, setCooldown] = useState<{ email: string; mode: Mode; until: number } | null>(null);
  const [clock, setClock] = useState(Date.now());
  const remaining = cooldown?.email === email.trim().toLowerCase() && cooldown.mode === mode
    ? Math.max(0, Math.ceil((cooldown.until - clock) / 1000)) : 0;
  const emailRef = useRef<HTMLInputElement>(null);
  const close = () => uiStore.set({ login: false });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setViaCode(false);
    // 只问一下验证码登录开没开，不会自动发验证码
    emailLoginStatus().then(setOtp, () => setOtp(null));
    // 只在焦点还没进对话框时才聚焦邮箱，否则会把正在输入的密码框的焦点抢走
    setTimeout(() => {
      if (!emailRef.current?.closest('.dialog')?.contains(document.activeElement)) emailRef.current?.focus();
    }, 60);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !cooldown || cooldown.until <= Date.now()) return;
    setClock(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= cooldown.until) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || remaining > 0) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError({ field: 'email', text: '填一个有效的邮箱。' });
    if (!password) return setError({ field: 'password', text: '填一下密码。' });
    // 注册时按账户服务的规则先查一遍，免得提交后只收到一句「内容不合规」
    const problem = mode === 'register' ? passwordProblem(password) : null;
    if (problem) return setError({ field: 'password', text: problem });
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
        toast('欢迎回来。');
      } else {
        await register(email.trim(), password, nickname.trim());
        // 注册成功后顺手兑换会员邀请码；没兑上也不影响注册，去个人中心还能再填
        const code = invite.trim();
        if (!code) toast('注册好了，唱片架会自动同步。');
        else {
          try {
            const r = await redeemCode(code);
            toast(r.enabled ? '注册好了，会员也开通了。' : '注册好了。邀请码已提交，会员暂时没生效，稍后去个人中心看看。');
          } catch (err) {
            toast(`注册好了，但邀请码没兑上：${(err as Error).message}可以去个人中心再填一次。`);
          }
        }
        setInvite('');
      }
      setPassword('');
      close();
    } catch (err) {
      const timed = err instanceof ApiError && err.status === 429 && !!err.retryAfterSeconds;
      if (timed) {
        const now = Date.now();
        setClock(now);
        setCooldown({ email: email.trim().toLowerCase(), mode, until: now + err.retryAfterSeconds! * 1000 });
      }
      const text = (err as Error).message;
      setError({ text, timed, locked: err instanceof ApiError && err.code === 5206 && err.status === 429 });
      toast(text);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (!mounted) return null;
  return (
    <>
      <div className="scrim" data-state={state} onClick={close} style={{ zIndex: 55 }} />
      <div className="dialog" data-state={state} role="dialog" aria-modal="true" aria-labelledby="login-title">
        <button className="icon-btn close" onClick={close} aria-label="关闭">
          <Icon name="close" />
        </button>
        <div className="seg seg-sm" role="tablist">
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>
        {mode === 'login' && viaCode ? (
          <CodeLogin
            email={email}
            setEmail={setEmail}
            status={otp}
            onBack={() => {
              setViaCode(false);
              setError(null);
            }}
            onDone={() => {
              setPassword('');
              close();
            }}
          />
        ) : (
          <>
        <h2 id="login-title">{mode === 'login' ? '回到唱片架' : '办一张会员卡'}</h2>
        <p className="muted small">登录后收藏和最近播放会在设备之间同步。</p>
        <form onSubmit={submit} noValidate className="login-form">
          <label className="float">
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder=" "
              aria-invalid={error?.field === 'email'}
            />
            <span>邮箱</span>
          </label>
          {error?.field === 'email' && <p className="field-error">{error.text}</p>}
          {mode === 'register' && (
            <label className="float">
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder=" " autoComplete="nickname" />
              <span>昵称（可选）</span>
            </label>
          )}
          <label className="float">
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error?.field === 'password') setError(null);
              }}
              placeholder=" "
              aria-invalid={error?.field === 'password'}
            />
            <span>密码</span>
          </label>
          {mode === 'register' && <PasswordRules value={password} />}
          {mode === 'register' && (
            <label className="float">
              <input
                className="mono"
                value={invite}
                onChange={(e) => setInvite(e.target.value.toUpperCase())}
                placeholder=" "
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
              />
              <span>会员邀请码（可选）</span>
            </label>
          )}
          {error?.field === 'password' && <p className="field-error">{error.text}</p>}
          {error && !error.field && <p className="field-error" role="alert">{error.timed
            ? remaining > 0 ? `${error.locked ? '密码连续输错，登录已暂时保护。' : '尝试太频繁了。'}请在 ${waitLabel(remaining)}后再试。` : '现在可以再试一次了。'
            : error.text}</p>}
          <button className="btn solid wide" disabled={busy || remaining > 0}>
            {busy ? '请稍候…' : remaining > 0 ? `${remaining} 秒后重试` : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>
        {mode === 'login' && otp?.enabled && (
          <button
            type="button"
            className="text-btn login-alt"
            onClick={() => {
              setViaCode(true);
              setError(null);
            }}
          >
            <Icon name="mail" size={15} /> 忘了密码？用邮箱验证码登录
          </button>
        )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * 邮箱辅助登录：发验证码 → 填验证码 → 和密码登录一样进账号。
 * 发送接口对没注册的邮箱也返回成功（不暴露账号是否存在），所以提示语不说「已发送」，说「如果注册过会收到」。
 * 重发会让旧验证码失效，只认最新一次的 challengeId；倒计时按服务端给的时间算。
 */
function CodeLogin({
  email,
  setEmail,
  status,
  onBack,
  onDone,
}: {
  email: string;
  setEmail: (v: string) => void;
  status: EmailLoginStatus | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const [challenge, setChallenge] = useState<{ id: string; email: string; resendAt: number; expiresAt: number } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<{ text: string; field?: 'email' | 'code' } | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const resendIn = useSecondsLeft(challenge?.resendAt ?? null);
  const blocked = useSecondsLeft(blockedUntil);
  const len = status?.codeLength ?? 6;
  const available = !!status?.available;
  const sameEmail = challenge?.email === email.trim().toLowerCase();

  const fail = (err: unknown, field?: 'email' | 'code') => {
    if (err instanceof ApiError && err.retryAfterSeconds && (err.status === 429 || err.code === 5910 || err.code === 5914)) {
      setBlockedUntil(Date.now() + err.retryAfterSeconds * 1000);
    }
    setError({ text: (err as Error).message, field });
  };

  const send = async () => {
    const to = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) return setError({ field: 'email', text: '填一个有效的邮箱。' });
    if (busy || blocked > 0 || (sameEmail && resendIn > 0)) return;
    setBusy('send');
    setError(null);
    try {
      const r = await requestLoginCode(to);
      // 服务端时间和本机可能差几秒：按服务端给的间隔换算成本机时间点
      const skew = Date.now() - Date.parse(r.serverTime);
      setChallenge({ id: r.challengeId, email: to.toLowerCase(), resendAt: Date.parse(r.resendAfter) + skew, expiresAt: Date.parse(r.expiresAt) + skew });
      setCode('');
    } catch (err) {
      fail(err, 'email');
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || busy) return;
    if (code.length !== len) return setError({ field: 'code', text: `验证码是 ${len} 位数字。` });
    if (Date.now() > challenge.expiresAt) return setError({ field: 'code', text: '验证码已经过期了，重新发一个。' });
    setBusy('verify');
    setError(null);
    try {
      await loginWithCode(challenge.id, code);
      toast('欢迎回来。');
      onDone();
    } catch (err) {
      setCode('');
      fail(err, 'code');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2 id="login-title">用验证码登录</h2>
      <p className="muted small">给已经注册的邮箱发一个 {len} 位验证码。只是登录，不会改你的密码。</p>
      {!status || !available ? (
        <p className="field-error login-code-off" role="status">
          {status && !status.enabled ? '验证码登录暂时关闭了，' : '邮件服务暂时不可用，'}先用密码登录，或者稍后再试。
        </p>
      ) : null}
      <form className="login-form" onSubmit={verify} noValidate>
        <div className="login-code-row">
          <label className="float">
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder=" "
              aria-invalid={error?.field === 'email'}
            />
            <span>邮箱</span>
          </label>
          <button
            type="button"
            className="btn login-send"
            onClick={() => void send()}
            disabled={!available || busy === 'send' || blocked > 0 || (sameEmail && resendIn > 0)}
          >
            {busy === 'send' ? '发送中…' : sameEmail && resendIn > 0 ? `${resendIn} 秒` : challenge && sameEmail ? '重新发送' : '发送验证码'}
          </button>
        </div>
        {error?.field === 'email' && <p className="field-error">{blocked > 0 ? `尝试太频繁了，请在 ${waitLabel(blocked)}后再试。` : error.text}</p>}
        {challenge && sameEmail && (
          <div className="login-code-step">
            <p className="login-code-note">
              <Icon name="mail" size={15} />
              <span>
                如该邮箱已注册，将收到登录验证码；新用户请先注册。{' '}
                <span className="faint">没收到的话看看垃圾邮件。</span>
              </span>
            </p>
            <OtpInput value={code} onChange={(v) => (setCode(v), setError(null))} length={len} invalid={error?.field === 'code'} autoFocus />
            {error?.field === 'code' && (
              <p className="field-error" role="alert">
                {blocked > 0 ? `尝试太频繁了，请在 ${waitLabel(blocked)}后再试。` : error.text}
              </p>
            )}
            <button className="btn solid wide" disabled={busy === 'verify' || code.length !== len || blocked > 0}>
              {busy === 'verify' ? '正在核对…' : '登录'}
            </button>
          </div>
        )}
      </form>
      <button type="button" className="text-btn login-alt" onClick={onBack}>
        <Icon name="left" size={15} /> 用密码登录
      </button>
    </>
  );
}
