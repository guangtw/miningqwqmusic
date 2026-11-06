import { useEffect, useId, useState } from 'react';
import { site } from '../config/site';
import { authStore, displayName } from '../lib/account';
import { fetchApplication, redeemCode, refreshEntitlement } from '../lib/membership';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';

const day = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};
const stamp = (iso?: string | null) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '' : `${day(iso!)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 限时会员还剩多久：满一天按天，不足一天按小时，再不足按分钟，都向上取整（刚兑换的 3 天码显示 3 天） */
const remain = (ms: number): [number, string] => {
  if (ms >= 86_400_000) return [Math.ceil(ms / 86_400_000), '天'];
  if (ms >= 3_600_000) return [Math.ceil(ms / 3_600_000), '小时'];
  return [Math.max(1, Math.ceil(ms / 60_000)), '分钟'];
};

// ---------------- 卡面纹样 ----------------
// 卡面按 340×214 的坐标画，右侧是一张唱片：中心一枚标签，外面绕着钞票式的扭索纹。
const CX = 290;
const CY = 104;

/** 一圈正弦起伏的圆环：半径 R、起伏 a、一圈 m 个波 */
const wave = (R: number, a: number, m: number) => {
  const steps = m * 16;
  let d = '';
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = R + a * Math.sin(m * t);
    d += `${i ? 'L' : 'M'}${(CX + r * Math.cos(t)).toFixed(1)} ${(CY + r * Math.sin(t)).toFixed(1)}`;
  }
  return `${d}Z`;
};

// 每条花环由同一圈波纹错开相位叠成；相位错开等于整圈转一个角度，所以每条只算一条路径，其余用 <use> 转出来
const BANDS = [
  { d: wave(112, 13, 18), m: 18, copies: 14, opacity: 0.13 },
  { d: wave(72, 8, 12), m: 12, copies: 10, opacity: 0.15 },
  { d: wave(45, 4, 9), m: 9, copies: 6, opacity: 0.12 },
];

function Guilloche() {
  const id = useId();
  return (
    <svg className="member-art" viewBox="0 0 340 214" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        {BANDS.map((b, i) => (
          <path key={i} id={`${id}b${i}`} d={b.d} />
        ))}
      </defs>
      {BANDS.map((b, i) => (
        <g key={i} opacity={b.opacity}>
          {Array.from({ length: b.copies }, (_, k) => (
            <use key={k} href={`#${id}b${i}`} transform={`rotate(${(-(k / b.copies) * 360) / b.m} ${CX} ${CY})`} />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** 唱片中心的标签：一圈环形小字、A 面和立体声字样、中心孔；开通后跟着唱片慢慢转 */
function RecordLabel({ text }: { text: string }) {
  const id = useId();
  return (
    <span className="member-label" aria-hidden="true">
      <svg viewBox="-32 -32 64 64">
        <defs>
          <radialGradient id={`${id}disc`}>
            <stop offset="0" className="lb-stop-in" />
            <stop offset="0.72" className="lb-stop-mid" />
            <stop offset="1" className="lb-stop-out" />
          </radialGradient>
          <path id={`${id}ring`} d="M -23 0 a 23 23 0 1 1 46 0 a 23 23 0 1 1 -46 0" />
        </defs>
        <circle r="31" className="lb-disc" fill={`url(#${id}disc)`} />
        <circle r="28" className="lb-line" />
        <circle r="12.5" className="lb-line" />
        <text className="lb-text">
          <textPath href={`#${id}ring`} textLength="144" lengthAdjust="spacing">
            {text}
          </textPath>
        </text>
        <text y="-4.6" textAnchor="middle" className="lb-small">
          SIDE A
        </text>
        <text y="7.4" textAnchor="middle" className="lb-small">
          STEREO
        </text>
        <circle r="1.7" className="lb-hole" />
      </svg>
    </span>
  );
}

/**
 * 会员卡：播放授权的状态和会员邀请码入口。
 * 没开通是一张黑色唱片纹的卡；开通后换成香槟金箔卡。
 * 永久会员压一个大号序号（第几位），限时会员压剩余时长、写到期时间，底下一道细槽显示这期还剩多少。
 * 账户服务没给会员类型（旧版本）时，照旧写来源和开通日期。
 */
export function MemberCard() {
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  const auth = useStore(authStore, (s) => s.playbackAuthorization);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = status === 'authenticated' && !!user;

  // 进设置页时再问一次：管理员可能刚给开通或撤销
  useEffect(() => {
    if (signedIn) void refreshEntitlement().catch(() => undefined);
  }, [signedIn, user?.id]);

  const enabled = signedIn && !!auth?.enabled;
  const expiresMs = Date.parse(auth?.expiresAt ?? '');
  const permanent = enabled && auth?.membershipKind === 'permanent';
  const timed = enabled && auth?.membershipKind === 'timed' && Number.isFinite(expiresMs);
  const number = auth?.memberNumber ?? null;

  // 限时会员的倒计时半分钟走一次
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [timed]);
  // 到点了以服务端为准再问一次，卡片随之变回未开通
  const due = timed && now >= expiresMs;
  useEffect(() => {
    if (due) void refreshEntitlement().catch(() => undefined);
  }, [due]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (c.length < 4) return setError('邀请码至少 4 位。');
    setBusy(true);
    setError(null);
    const before = timed ? auth?.expiresAt : undefined;
    try {
      const r = await redeemCode(c);
      // 用的可能是申请发来的码：申请那一栏跟着更新
      void fetchApplication().catch(() => undefined);
      if (r.enabled && before && r.membershipKind === 'timed' && r.expiresAt === before) {
        setError('这个邀请码已经用在你的账号上了，到期时间没变。');
      } else if (r.enabled) {
        toast(
          r.membershipKind === 'timed' && r.expiresAt
            ? `${before ? '续上了' : '开通了'}，${stamp(r.expiresAt)} 到期。`
            : before
              ? '升级成永久会员了。'
              : '开通了。正在放的歌会按新权限重新取音源。',
        );
        setCode('');
      } else setError('邀请码已提交，但账号暂时没有拿到授权，稍后刷新看看。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const source = auth?.source === 'invite' ? `邀请码${auth.inviteLabel ? `「${auth.inviteLabel}」` : ''}` : auth?.source === 'manual' ? '管理员开通' : '';
  const lapsed = signedIn && !enabled ? auth?.status : undefined;
  const [left, unit] = timed ? remain(expiresMs - now) : [0, ''];
  // 这一期（最近一次开通或续期到到期）还剩多少，画成卡片底部的细槽
  const term = timed ? (expiresMs - now) / (expiresMs - Date.parse(auth?.grantedAt ?? '')) : NaN;
  const soon = timed && expiresMs - now < 86_400_000;

  // 标签上那圈小字
  const ring = `${site.brand.big.toUpperCase()} · ${site.brand.small} · ${
    permanent && number ? `MEMBER · Nº ${String(number).padStart(3, '0')}` : timed ? 'MEMBER · 限时' : 'MEMBER CARD'
  } · `;
  const state = enabled ? 'MEMBER' : lapsed === 'expired' ? '已到期' : lapsed === 'revoked' ? '已撤销' : signedIn ? '未开通' : '游客';
  const label = permanent
    ? number ? `第 ${number} 位永久会员` : '永久会员'
    : timed ? `限时会员，剩 ${left} ${unit}，${stamp(auth?.expiresAt)} 到期`
    : enabled ? '播放授权已开通' : lapsed === 'expired' ? '限时会员已到期' : '播放授权未开通';

  return (
    <div className="member">
      <div className={`member-card ${enabled ? 'gold' : ''} ${soon ? 'soon' : ''}`} role="img" aria-label={label}>
        <Guilloche />
        <RecordLabel text={ring} />
        <div className="member-top">
          <span className="member-brand">
            {site.brand.big}
            <small>{site.brand.small}</small>
          </span>
          <span className="member-state">{state}</span>
        </div>
        {permanent && number ? (
          <div className="member-title ranked">
            <b className="member-no">
              <sup>Nº</sup>
              {number}
            </b>
            <span className="member-kind">永久会员</span>
          </div>
        ) : timed ? (
          <div className="member-title ranked">
            <b className="member-no">{left}</b>
            <span className="member-kind">
              {unit} · 限时会员
            </span>
          </div>
        ) : (
          <div className="member-title">{permanent ? '永久会员' : '播放授权'}</div>
        )}
        {Number.isFinite(term) && (
          <span className="member-term" aria-hidden="true">
            <i style={{ '--left': Math.min(1, Math.max(0.03, term)) } as React.CSSProperties} />
          </span>
        )}
        <div className="member-bottom mono">
          <span>{signedIn ? displayName(user!) : '登录后开通'}</span>
          {timed ? (
            <span>{stamp(auth?.expiresAt)} 到期</span>
          ) : permanent && auth?.grantedAt ? (
            <span>{day(auth.grantedAt)} 开通</span>
          ) : enabled ? (
            <span>
              {source}
              {auth?.grantedAt && ` · ${day(auth.grantedAt)}`}
            </span>
          ) : lapsed === 'expired' && auth?.expiresAt ? (
            <span>{day(auth.expiresAt)} 到期</span>
          ) : null}
        </div>
      </div>

      <div className="member-side">
        <ul className="member-perks">
          <li>原平台放不了的歌（灰色、只有试听片段），会尝试换其他音源放完整版</li>
          <li>音质按你选的档位走，音源不够时自动降档</li>
        </ul>
        <p className="member-free">
          <b>永久免费</b>
          <span>本站会员不收一分钱，设置会员只是限流的手段。</span>
        </p>
        {!signedIn ? (
          status === 'guest' ? (
            <button className="btn sm" onClick={() => uiStore.set({ login: true })}>
              登录后填邀请码
            </button>
          ) : null
        ) : enabled && !timed ? (
          <p className="muted small">
            {permanent ? '永久有效，不需要再填邀请码。' : '已开通，不需要再填邀请码。'}授权被撤销时这里会变回未开通。
          </p>
        ) : (
          <>
            {timed && <p className="muted small">到期前再填限时码，会从到期时间往后顺延；填永久码直接升级成永久会员。</p>}
            {lapsed === 'expired' && <p className="muted small">限时会员已到期，填新的邀请码重新开通。</p>}
            <form className="member-form" onSubmit={submit} noValidate>
              <input
                className="member-input mono"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                placeholder={timed ? '填邀请码续期或升级' : '填会员邀请码'}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                aria-label="会员邀请码"
                aria-invalid={!!error}
              />
              <button className="btn solid sm" disabled={busy || !code.trim()}>
                {busy ? (timed ? '续期中…' : '开通中…') : timed ? '续期' : '开通'}
              </button>
            </form>
          </>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>
    </div>
  );
}
