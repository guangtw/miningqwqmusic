import { useEffect, useRef, useState } from 'react';
import type { MailDeliveryStatus, MembershipStatusResponse } from '@/src/types/membership';
import { authStore } from '../lib/account';
import {
  applyMembership,
  applyStore,
  fetchApplication,
  redeemCode,
  refreshEntitlement,
  requestMemberCode,
  resendOffer,
  serverNow,
  verifyMemberCode,
  withdrawApplication,
} from '../lib/membership';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { FamiliarEntry } from './FamiliarQuest';
import { Icon } from './Icon';
import { OtpInput, useSecondsLeft } from './OtpInput';

const pad = (n: number) => String(n).padStart(2, '0');
/** 按本地时区：11.05 20:00 */
const when = (iso: string | null | undefined) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** 还剩多久：23 小时 12 分 / 8 分钟 */
const left = (ms: number) => {
  if (ms <= 0) return '已经过了截止时间';
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `还剩 ${Math.floor(m / 60)} 小时 ${m % 60} 分` : `还剩 ${m} 分钟`;
};

const MAIL: Record<MailDeliveryStatus, string> = {
  pending: '兑换码正在排队发出',
  processing: '兑换码正在发送',
  sent: '兑换码已经发到邮箱',
  failed: '邮件没发出去',
  cancelled: '这封邮件已经取消',
};

type Step = 0 | 1 | 2 | 3;
const STEPS = ['确认邮箱', '申请', '收码', '兑换'];

/** 等通知和等兑换的时候在后台轮询：页面可见才问，切回来立刻问一次 */
function usePolling(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const tick = () => document.visibilityState === 'visible' && void fetchApplication().catch(() => undefined);
    const t = window.setInterval(tick, 20_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [active]);
}

/**
 * 会员申请：确认邮箱 → 申请 → 收码 → 兑换。
 * 申请不占名额，获批时服务端把兑换码发到账号邮箱。能不能申请、位置、时长几天全听服务端的，
 * 这里只把状态说清楚，不承诺先后和结果；按钮防连点，但真正的幂等交给服务端
 */
export function MemberApply() {
  const userId = useStore(authStore, (s) => s.user?.id);
  const email = useStore(authStore, (s) => s.user?.email ?? '');
  const mine = useStore(applyStore, (s) => (s.userId === userId ? s.status : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setError(null);
    fetchApplication().catch((e) => setError((e as Error).message));
  }, [userId]);

  const app = mine?.application;
  usePolling(app?.status === 'queued' || app?.status === 'offered');

  if (!mine) {
    return error ? (
      <p className="field-error">
        {error}{' '}
        <button className="text-btn" onClick={() => void fetchApplication().then(() => setError(null), (e) => setError((e as Error).message))}>
          重试
        </button>
      </p>
    ) : (
      <div className="apply">
        <div className="skeleton" style={{ height: 14, width: '60%' }} />
      </div>
    );
  }

  const step: Step =
    app?.status === 'offered' ? 2 : app?.status === 'queued' ? 1 : mine.reason === 'email_verification_required' || !mine.emailVerifiedAt ? 0 : 1;

  return (
    <div className="apply">
      <FamiliarEntry />
      {mine.reason !== 'already_member' && mine.reason !== 'application_blocked' && (mine.applicationsOpen || app) && (
        <ol className="apply-steps mono" aria-label="申请进度">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'done' : i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined}>
              <i aria-hidden="true">{i < step ? <Icon name="check" size={11} /> : i + 1}</i>
              {s}
            </li>
          ))}
        </ol>
      )}
      <Body s={mine} email={email} />
    </div>
  );
}

/** 系统只发 3 天或 7 天；更长的会员卡是本人给微信好友的，不走申请 */
function MoreDays() {
  return <p className="apply-more">3 天、7 天不够用？有我微信的朋友大胆来私信，一个月甚至更长的会员卡都有。</p>;
}

function Body({ s, email }: { s: MembershipStatusResponse; email: string }) {
  const blocked = s.reason === 'application_blocked' || s.application?.status === 'blocked';
  return (
    <>
      <Stage s={s} email={email} />
      {!blocked && s.applicationsOpen !== false && s.emailVerifiedAt && <MoreDays />}
    </>
  );
}

function Stage({ s, email }: { s: MembershipStatusResponse; email: string }) {
  const app = s.application;
  if (s.reason === 'already_member') {
    return <p className="muted small">你已经是会员了，申请码不能叠加时长。限时会员到期后，可以回到这里重新申请。</p>;
  }
  if (s.reason === 'application_blocked' || app?.status === 'blocked') {
    return <p className="muted small apply-blocked">这个账号的申请受到限制，暂时不能申请。有疑问可以联系管理员。</p>;
  }
  if (app?.status === 'queued') return <Queued s={s} />;
  if (app?.status === 'offered') return <Offered s={s} email={email} />;
  if (!s.applicationsOpen) {
    return <p className="muted small">会员申请暂时没有开放。名额有限，开放以后可以在这里申请。</p>;
  }
  if (s.reason === 'email_verification_required' || !s.emailVerifiedAt) return <ConfirmEmail email={email} />;
  return <Apply s={s} email={email} />;
}

/** 第一步：确认账号邮箱。验证码只发到账号自己的邮箱，确认过一次就不用再确认 */
function ConfirmEmail({ email }: { email: string }) {
  const [challenge, setChallenge] = useState<{ id: string; resendAt: number; expiresAt: number } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resendIn = useSecondsLeft(challenge?.resendAt ?? null);

  const send = async () => {
    if (busy || resendIn > 0) return;
    setBusy('send');
    setError(null);
    try {
      const r = await requestMemberCode();
      const skew = Date.now() - Date.parse(r.serverTime);
      setChallenge({ id: r.challengeId, resendAt: Date.parse(r.resendAfter) + skew, expiresAt: Date.parse(r.expiresAt) + skew });
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || busy || code.length !== 6) return;
    if (Date.now() > challenge.expiresAt) return setError('验证码已经过期了，重新发一个。');
    setBusy('verify');
    setError(null);
    try {
      await verifyMemberCode(challenge.id, code);
      toast('邮箱确认好了，现在可以申请了。');
    } catch (err) {
      setCode('');
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="apply-body">
      <p className="apply-lead">
        申请前先确认一下 <b>{email}</b> 是你的邮箱，兑换码之后也会发到这里。
      </p>
      {!challenge ? (
        <button className="btn sm" onClick={() => void send()} disabled={!!busy}>
          <Icon name="mail" size={16} /> {busy === 'send' ? '发送中…' : '发送验证码'}
        </button>
      ) : (
        <form className="apply-otp" onSubmit={verify} noValidate>
          <OtpInput value={code} onChange={(v) => (setCode(v), setError(null))} invalid={!!error} autoFocus />
          <div className="apply-actions">
            <button className="btn solid sm" disabled={busy === 'verify' || code.length !== 6}>
              {busy === 'verify' ? '正在核对…' : '确认邮箱'}
            </button>
            <button type="button" className="text-btn" onClick={() => void send()} disabled={!!busy || resendIn > 0}>
              {resendIn > 0 ? `${resendIn} 秒后可以重发` : '重新发送'}
            </button>
          </div>
          <p className="help">验证码 10 分钟内有效。没收到的话看看垃圾邮件。</p>
        </form>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** 可以申请：说清楚规则再让人点，不替用户自动提交 */
function Apply({ s, email }: { s: MembershipStatusResponse; email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prev = s.application?.status;

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await applyMembership();
      if (r.application?.status === 'queued') toast('申请提交了，有通知会发到邮箱。');
      else if (r.application?.status === 'offered') toast('名额留给你了，兑换码正在发往邮箱。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="apply-body">
      {prev === 'expired' && <p className="apply-lead">上一次的兑换机会过期了，可以重新申请。</p>}
      {prev === 'cancelled' && <p className="apply-lead">申请已经撤回了，想要的话可以重新申请。</p>}
      {prev === 'redeemed' && <p className="apply-lead">上一期会员已经结束了，可以重新申请。</p>}
      <ul className="apply-rules">
        <li>申请不占名额。获批时，兑换码会发到 {email}，收到后 24 小时内兑换。</li>
        <li>会员时长是 3 天或 7 天，看当时的名额；从兑换成功那一刻开始算。</li>
        <li>名额有限，申请不保证一定获批；到期后不会自动续期，可以再来申请。</li>
      </ul>
      {s.canApply ? (
        <button className="btn solid sm" onClick={() => void go()} disabled={busy}>
          {busy ? '正在提交…' : '申请会员'}
        </button>
      ) : (
        <p className="muted small">暂时不能申请，稍后再来看看。</p>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** 撤回要点两次，免得手滑 */
function Withdraw({ label = '撤回申请' }: { label?: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`text-btn ${armed ? 'danger' : ''}`}
      disabled={busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try {
          await withdrawApplication();
          toast('申请撤回了。');
        } catch (e) {
          toast((e as Error).message);
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {busy ? '撤回中…' : armed ? '再点一次撤回' : label}
    </button>
  );
}

/** 等通知：一张申请单。位置只是自己这边的相对位置，不代表先后承诺 */
function Queued({ s }: { s: MembershipStatusResponse }) {
  const app = s.application!;
  const n = app.queuePosition;
  return (
    <div className="apply-body">
      <div className="qticket">
        <div className="qticket-main">
          <span className="qticket-kicker mono">申请位置</span>
          <b className="qticket-no" key={n ?? 'x'}>
            <sup>Nº</sup>
            {n ?? '—'}
          </b>
          <span className="qticket-sub">等待通知</span>
        </div>
        <div className="qticket-foot mono">
          <span>{when(app.queuedAt)} 申请</span>
          <span>{s.dispatchEnabled ? '等待通知' : '发码暂停中'}</span>
        </div>
      </div>
      <p className="help">
        位置会变化，不代表先后，也不代表什么时候有结果。获批时会发邮件，这里也会自动更新。
        {!s.dispatchEnabled && ' 现在暂停发码，申请记录会保留。'}
      </p>
      <Withdraw />
    </div>
  );
}

/** 名额留给你了：显示时长、兑换截止和邮件状态；这里直接填码兑换 */
function Offered({ s, email }: { s: MembershipStatusResponse; email: string }) {
  const app = s.application!;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'redeem' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(serverNow);
  const offset = useStore(applyStore, (x) => x.offset);
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const deadline = Date.parse(app.redeemBy ?? '');
  // resendAfter 是服务端时间，换成本机时间点再倒数
  const resendIn = useSecondsLeft(app.resendAfter ? Date.parse(app.resendAfter) - offset : null);
  const mail = app.deliveryStatus;
  const sending = mail === 'pending' || mail === 'processing';
  const inputRef = useRef<HTMLInputElement>(null);

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    setBusy('redeem');
    setError(null);
    try {
      const r = await redeemCode(c);
      await fetchApplication().catch(() => undefined);
      void refreshEntitlement().catch(() => undefined);
      setCode('');
      toast(r.enabled ? `会员开通了${r.expiresAt ? `，${when(r.expiresAt)} 到期` : ''}。` : '兑换码已提交，稍后刷新看看。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    if (busy || resendIn > 0) return;
    setBusy('resend');
    setError(null);
    try {
      await resendOffer();
      toast('重新排进发送队列了，同一张码，截止时间不变。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="apply-body">
      <div className="qticket offered">
        <div className="qticket-main">
          <span className="qticket-kicker mono">名额留给你了</span>
          <b className="qticket-no">
            {app.durationDays ?? '?'}
            <small>天会员</small>
          </b>
          <span className="qticket-sub">
            {when(app.redeemBy)} 前兑换 · {Number.isFinite(deadline) ? left(deadline - now) : ''}
          </span>
        </div>
        <span className="qticket-stamp mono" aria-hidden="true">
          已留号
        </span>
        <div className={`qticket-foot mail-${mail ?? 'none'}`}>
          <span className="qticket-mail">
            {sending && <i className="ticket-pulse" aria-hidden="true" />}
            {mail ? MAIL[mail] : '兑换码会发到邮箱'}
            {mail === 'sent' && <span className="faint">（{email}）</span>}
          </span>
          {(mail === 'sent' || mail === 'failed') && (
            <button className="text-btn" onClick={() => void resend()} disabled={!!busy || resendIn > 0}>
              {busy === 'resend' ? '重发中…' : resendIn > 0 ? `${resendIn} 秒后可重发` : '重发邮件'}
            </button>
          )}
        </div>
      </div>
      {mail === 'sent' && <p className="help">「已发到邮箱」表示邮件服务已经接收，不一定马上进收件箱；没看到的话看看垃圾邮件。兑换码只发邮件，网页上不显示。</p>}
      {mail === 'failed' && <p className="help">兑换码还有效，不用重新申请，点「重发邮件」就行。</p>}
      <form className="member-form apply-redeem" onSubmit={redeem} noValidate>
        <input
          ref={inputRef}
          className="member-input mono"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          placeholder="贴上邮件里的兑换码"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          aria-label="会员兑换码"
          aria-invalid={!!error}
        />
        <button className="btn solid sm" disabled={busy === 'redeem' || !code.trim()}>
          {busy === 'redeem' ? '兑换中…' : '兑换'}
        </button>
      </form>
      {error && <p className="field-error">{error}</p>}
      <Withdraw label="不要了，撤回" />
    </div>
  );
}
