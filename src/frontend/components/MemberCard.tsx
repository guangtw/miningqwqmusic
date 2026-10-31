import { useEffect, useState } from 'react';
import { site } from '../config/site';
import { authStore, displayName } from '../lib/account';
import { redeemCode, refreshEntitlement } from '../lib/membership';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore } from '../player/ui';

const day = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 会员卡：播放授权的状态和兑换码入口。
 * 没开通是一张黑色唱片纹的卡；开通后换成香槟金箔卡，写上来源和开通日期。
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (c.length < 4) return setError('兑换码至少 4 位。');
    setBusy(true);
    setError(null);
    try {
      const r = await redeemCode(c);
      if (r.enabled) {
        toast('开通了。正在放的歌会按新权限重新取音源。');
        setCode('');
      } else setError('兑换已处理，但账号暂时没有拿到授权，稍后刷新看看。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const source = auth?.source === 'invite' ? `兑换码${auth.inviteLabel ? `「${auth.inviteLabel}」` : ''}` : auth?.source === 'manual' ? '管理员开通' : '';

  return (
    <div className="member">
      <div className={`member-card ${enabled ? 'gold' : ''}`} aria-label={enabled ? '播放授权已开通' : '播放授权未开通'}>
        <span className="member-grooves" aria-hidden="true" />
        <div className="member-top">
          <span className="member-brand">
            {site.brand.big}
            <small>{site.brand.small}</small>
          </span>
          <span className="member-state mono">{enabled ? 'MEMBER' : signedIn ? '未开通' : '游客'}</span>
        </div>
        <div className="member-title">播放授权</div>
        <div className="member-bottom mono">
          <span>{signedIn ? displayName(user!) : '登录后兑换'}</span>
          {enabled && (
            <span>
              {source}
              {auth?.grantedAt && ` · ${day(auth.grantedAt)}`}
            </span>
          )}
        </div>
      </div>

      <div className="member-side">
        <ul className="member-perks">
          <li>原平台放不了的歌（灰色、只有试听片段），会尝试换其他音源放完整版</li>
          <li>音质按你选的档位走，音源不够时自动降档</li>
        </ul>
        {!signedIn ? (
          status === 'guest' ? (
            <button className="btn sm" onClick={() => uiStore.set({ login: true })}>
              登录后兑换
            </button>
          ) : null
        ) : enabled ? (
          <p className="muted small">已开通，不需要再兑换。授权被撤销时这里会变回未开通。</p>
        ) : (
          <form className="member-form" onSubmit={submit} noValidate>
            <input
              className="member-input mono"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
              placeholder="输入兑换码"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              aria-label="兑换码"
              aria-invalid={!!error}
            />
            <button className="btn solid sm" disabled={busy || !code.trim()}>
              {busy ? '兑换中…' : '兑换'}
            </button>
          </form>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>
    </div>
  );
}
