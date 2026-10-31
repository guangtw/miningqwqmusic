import { useEffect, useRef, useState } from 'react';
import { login, register } from '../lib/account';
import { usePresence } from '../lib/motion';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';
import { Icon } from './Icon';

type Mode = 'login' | 'register';

/** 登录 / 注册：对接 BFF 代理的账户服务（/api/account/auth/*） */
export function LoginDialog() {
  const open = useStore(uiStore, (s) => s.login);
  const { mounted, state } = usePresence(open, 220);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<{ field?: 'email' | 'password'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const close = () => uiStore.set({ login: false });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTimeout(() => emailRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError({ field: 'email', text: '填一个有效的邮箱。' });
    if (password.length < (mode === 'register' ? 8 : 1))
      return setError({ field: 'password', text: mode === 'register' ? '密码至少 8 位。' : '填一下密码。' });
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, nickname.trim());
      toast(mode === 'login' ? '欢迎回来。' : '注册好了，唱片架会自动同步。');
      setPassword('');
      close();
    } catch (err) {
      setError({ text: (err as Error).message });
    } finally {
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
                if (error?.field === 'email') setError(null);
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
          {error?.field === 'password' && <p className="field-error">{error.text}</p>}
          {error && !error.field && <p className="field-error">{error.text}</p>}
          <button className="btn solid wide" disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>
      </div>
    </>
  );
}
