import { useCallback, useEffect, useState } from 'react';
import type {
  MembershipAdminApplication,
  MembershipAdminMail,
  MembershipAdminState,
  MembershipApplicationStatus,
  MembershipAuditView,
  MembershipDecision,
  MembershipPolicyChanges,
} from '@/src/types/membership';
import { ErrorState, Loading } from '../components/States';
import { actOnApplication, adminApplications, adminAudit, adminMail, adminMembership, retryMail, setMembershipPolicy } from '../lib/membership';
import { toast } from '../lib/toast';

const pad = (n: number) => String(n).padStart(2, '0');
const when = (iso: string | null | undefined) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const ago = (iso: string | null, now: number) => {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.round(s / 60)} 分钟前` : `${Math.round(s / 3600)} 小时前`;
};

const STATUS: Record<MembershipApplicationStatus, string> = {
  queued: '排队中',
  offered: '已发码',
  redeemed: '已兑换',
  expired: '已过期',
  cancelled: '已取消',
  blocked: '已限制',
};

const REASON: Record<MembershipDecision['reason'], string> = {
  normal: '正常发放',
  hard_limit: '已到硬顶 15，不能再发',
  soft_wait: '软限制区：队首还没等满 24 小时',
  spill_interval: '软限制区：距上次额外发放不满 24 小时',
  release_expected: '软限制区：24 小时内预计有名额释放，先等',
  controlled_spill: '软限制区：放行队首一人，3 天',
};

const SWITCHES: { key: keyof MembershipPolicyChanges; label: string; help: string }[] = [
  { key: 'applicationsOpen', label: '开放申请', help: '关掉后不能新申请、不能确认邮箱；已经排队的保留。' },
  { key: 'dispatchEnabled', label: '自动发码', help: '关掉后不再给队首发新码；已发的码照常兑换、邮件照常重试。' },
  { key: 'emailLoginEnabled', label: '邮箱验证码登录', help: '单独暂停「忘了密码用验证码登录」，不影响密码登录。' },
];

/**
 * 会员申请管理：名额、开关、申请、邮件、审计。
 * 名额按「有效会员 + 已发未兑换的预留」算，不能只看有效会员就以为还有空位；
 * 所有操作的权限和硬顶都在服务端，这里只是把状态和错误说清楚
 */
export function MembershipAdmin() {
  const [state, setState] = useState<MembershipAdminState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    adminMembership().then(
      (s) => {
        setState(s);
        setError(null);
        setNow(Date.now());
      },
      (e) => setError(e as Error),
    );
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const flip = async (key: keyof MembershipPolicyChanges) => {
    if (!state || busy) return;
    setBusy(key);
    try {
      await setMembershipPolicy({ [key]: !state.policy[key] });
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !state) return <ErrorState error={error} onRetry={load} />;
  if (!state) return <Loading rows={4} />;
  const { capacity: c, policy, nextDecision: d } = state;
  const heartbeat = ago(policy.workerHeartbeatAt, Date.parse(state.serverTime) || now);
  const workerOk = !!policy.workerHeartbeatAt && Date.parse(state.serverTime) - Date.parse(policy.workerHeartbeatAt) < 120_000;

  return (
    <div className="madmin">
      <section className="madmin-cap reveal" aria-label="名额">
        <div className="madmin-cap-head">
          <b className="madmin-big">
            {c.occupied}
            <small>/ {c.hardLimit}</small>
          </b>
          <span className="madmin-cap-text">
            已占用名额
            <small className="mono">
              有效 {c.active}（永久 {c.permanent}）· 预留 {c.reserved}
            </small>
          </span>
        </div>
        <div className="madmin-slots" role="img" aria-label={`有效会员 ${c.active} 个，预留 ${c.reserved} 个，共 ${c.hardLimit} 个名额`}>
          {Array.from({ length: c.hardLimit }, (_, i) => (
            <i
              key={i}
              // 第 softThreshold 个名额起（第 10 到 15 个）是软限制区
              className={i < c.active ? 'active' : i < c.occupied ? 'reserved' : i >= policy.softThreshold - 1 ? 'soft' : ''}
              style={{ '--i': i } as React.CSSProperties}
            />
          ))}
          <span className="madmin-mark mono" style={{ '--at': (policy.softThreshold - 1) / c.hardLimit } as React.CSSProperties}>
            {policy.softThreshold}
          </span>
        </div>
        <p className="madmin-legend mono">
          <span>
            <i className="active" /> 有效会员
          </span>
          <span>
            <i className="reserved" /> 已发码待兑换
          </span>
          <span>
            <i className="soft" /> 软限制区（只放 3 天）
          </span>
        </p>
      </section>

      <section className="madmin-switches reveal" style={{ '--i': 1 } as React.CSSProperties} aria-label="开关">
        {SWITCHES.map((s) => (
          <div key={s.key} className="madmin-switch">
            <span>
              <b>{s.label}</b>
              <small>{s.help}</small>
            </span>
            <button
              role="switch"
              aria-checked={policy[s.key]}
              aria-label={s.label}
              className={`switch ${policy[s.key] ? 'on' : ''}`}
              disabled={busy === s.key}
              onClick={() => void flip(s.key)}
            >
              <i />
            </button>
          </div>
        ))}
      </section>

      <section className="madmin-facts reveal" style={{ '--i': 2 } as React.CSSProperties} aria-label="运行情况">
        <div>
          <small>排队</small>
          <b>{state.queued} 人</b>
        </div>
        <div>
          <small>下一次判断</small>
          <b>{d ? (d.allowed ? `可以发 · ${d.durationDays} 天` : '先不发') : state.queued ? '—' : '没人排队'}</b>
          {d && <span className="mono">{REASON[d.reason]}</span>}
          {d && (
            <span className="mono faint">
              8 天预算 {d.personDays.toFixed(1)} 人天 · 人均 {d.perApplicant.toFixed(1)}
            </span>
          )}
        </div>
        <div>
          <small>后台任务</small>
          <b className={workerOk ? '' : 'warn'}>{workerOk ? '在线' : '没有心跳'}</b>
          <span className="mono faint">{heartbeat ? `${heartbeat}` : '从没上报过'}</span>
        </div>
        <div>
          <small>邮件</small>
          <b className={state.mail.failed ? 'warn' : ''}>
            待发 {state.mail.pending} · 失败 {state.mail.failed}
          </b>
          <span className="mono faint">上次调度 {when(policy.lastDispatchAt)}</span>
        </div>
      </section>

      <Applications onChange={load} />
      <Mails onChange={load} />
      <Audit />
    </div>
  );
}

/** 按 id 往后翻页的列表：每页 50 条，cursor 是上一页最后一条的 id */
function usePaged<T extends { id: string }>(fetchPage: (cursor?: string) => Promise<T[]>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reload = useCallback(() => {
    fetchPage().then(
      (r) => {
        setRows(r);
        setMore(r.length >= 50);
        setError(null);
      },
      (e) => setError(e as Error),
    );
  }, [fetchPage]);
  useEffect(reload, [reload]);
  const next = () => {
    const last = rows?.at(-1)?.id;
    if (!last) return;
    fetchPage(last).then(
      (r) => {
        setRows((x) => [...(x ?? []), ...r]);
        setMore(r.length >= 50);
      },
      (e) => toast((e as Error).message),
    );
  };
  return { rows, more, error, reload, next };
}

function Applications({ onChange }: { onChange: () => void }) {
  const { rows, more, error, reload, next } = usePaged<MembershipAdminApplication>(adminApplications);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (a: MembershipAdminApplication, action: 'cancel' | 'block' | 'unblock') => {
    const key = `${a.id}:${action}`;
    if (action !== 'unblock' && armed !== key) return setArmed(key);
    setArmed(null);
    setBusy(a.id);
    try {
      await actOnApplication(a.id, action);
      toast(action === 'cancel' ? '申请取消了，未兑换的码已经作废。' : action === 'block' ? '已限制这个账号申请。' : '解除限制了，对方需要自己重新申请。');
      reload();
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="madmin-sec reveal" style={{ '--i': 3 } as React.CSSProperties}>
      <div className="section-head">
        <h2>申请</h2>
        <span className="mono faint small">列表按创建先后，不代表排队顺序</span>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !rows ? (
        <Loading rows={3} />
      ) : !rows.length ? (
        <p className="muted small">还没有人申请。</p>
      ) : (
        <div className="admin-list madmin-list" role="list">
          {rows.map((a) => {
            const open = a.status === 'queued' || a.status === 'offered';
            return (
              <div key={a.id} role="listitem" className="admin-row madmin-row">
                <span className="admin-who">
                  <span className="t">{a.user.nickname || a.user.email.split('@')[0]}</span>
                  <span className="a">{a.user.email}</span>
                </span>
                <span className={`madmin-status s-${a.status}`}>{STATUS[a.status]}</span>
                <span className="madmin-when mono">
                  {a.status === 'offered' || a.status === 'redeemed'
                    ? `${a.durationDays ?? '?'} 天 · ${a.inviteCode?.redeemedAt ? `${when(a.inviteCode.redeemedAt)} 兑换` : `${when(a.inviteCode?.expiresAt)} 截止`}`
                    : `${when(a.queuedAt)} 排队`}
                  {a.version > 1 && ` · 第 ${a.version} 次`}
                </span>
                <span className="madmin-acts">
                  {open && (
                    <button className={`text-btn ${armed === `${a.id}:cancel` ? 'danger' : ''}`} disabled={busy === a.id} onClick={() => void act(a, 'cancel')}>
                      {armed === `${a.id}:cancel` ? '确认取消' : '取消'}
                    </button>
                  )}
                  {a.status !== 'blocked' && a.status !== 'redeemed' && (
                    <button className={`text-btn ${armed === `${a.id}:block` ? 'danger' : ''}`} disabled={busy === a.id} onClick={() => void act(a, 'block')}>
                      {armed === `${a.id}:block` ? '确认限制' : '限制'}
                    </button>
                  )}
                  {a.status === 'blocked' && (
                    <button className="text-btn" disabled={busy === a.id} onClick={() => void act(a, 'unblock')}>
                      解除限制
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {more && (
            <button className="btn sm ghost madmin-more" onClick={next}>
              再看 50 条
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const MAIL_STATUS: Record<MembershipAdminMail['status'], string> = { pending: '待发', processing: '发送中', sent: '已接收', failed: '失败', cancelled: '已取消' };
const MAIL_KIND: Record<string, string> = { login_otp: '登录验证码', membership_otp: '邮箱确认', membership_offer: '兑换码' };

function Mails({ onChange }: { onChange: () => void }) {
  const { rows, more, error, reload, next } = usePaged<MembershipAdminMail>(adminMail);
  const [busy, setBusy] = useState<string | null>(null);
  const retry = async (m: MembershipAdminMail) => {
    setBusy(m.id);
    try {
      await retryMail(m.id);
      toast('重新排进发送队列了。');
      reload();
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="madmin-sec reveal" style={{ '--i': 4 } as React.CSSProperties}>
      <div className="section-head">
        <h2>邮件</h2>
        <span className="mono faint small">「已接收」是邮件服务商收下了，不代表进了收件箱</span>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !rows ? (
        <Loading rows={3} />
      ) : !rows.length ? (
        <p className="muted small">还没有发过邮件。</p>
      ) : (
        <div className="admin-list madmin-list" role="list">
          {rows.map((m) => (
            <div key={m.id} role="listitem" className="admin-row madmin-row">
              <span className="admin-who">
                <span className="t">{MAIL_KIND[m.kind] ?? m.kind}</span>
                <span className="a">{m.toAddress}</span>
              </span>
              {/* 验证码用掉、兑换码兑掉以后任务会被收尾成 cancelled：发出过的写「已失效」，不是没发 */}
              <span className={`madmin-status m-${m.status}`}>{m.status === 'cancelled' && m.sentAt ? '已失效' : MAIL_STATUS[m.status]}</span>
              <span className="madmin-when mono">
                {m.sentAt ? `${when(m.sentAt)} 发出` : `${when(m.createdAt)} 创建`} · 第 {m.attempts} 次
                {m.lastErrorCode && <span className="faint"> · {m.lastErrorCode}</span>}
              </span>
              <span className="madmin-acts">
                {m.status === 'failed' && Date.parse(m.expiresAt) > Date.now() && (
                  <button className="text-btn" disabled={busy === m.id} onClick={() => void retry(m)}>
                    {busy === m.id ? '重试中…' : '重试'}
                  </button>
                )}
              </span>
            </div>
          ))}
          {more && (
            <button className="btn sm ghost madmin-more" onClick={next}>
              再看 50 条
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const EVENT: Record<string, string> = {
  application_queued: '排队',
  application_cancelled: '用户撤回',
  application_admin_cancelled: '管理员取消',
  application_blocked: '限制申请',
  application_unblocked: '解除限制',
  offer_issued: '自动发码',
  offer_expired: '码过期',
  offer_mail_requeued: '重发兑换码',
  mail_delivery_failed: '邮件失败',
  mail_admin_retry: '管理员重试邮件',
  policy_updated: '开关变更',
  membership_email_verified: '确认邮箱',
  email_login_verified: '验证码登录',
  offer_redeemed: '兑换成功',
  manual_membership_granted: '人工开通',
  membership_revoked: '撤销会员',
};

/** 审计：默认收起，打开才去取 */
function Audit() {
  const [open, setOpen] = useState(false);
  return (
    <section className="madmin-sec reveal" style={{ '--i': 5 } as React.CSSProperties}>
      <details className="madmin-audit" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <h2>审计记录</h2>
          <span className="mono faint small">自动批准、管理操作都在这里，保留 180 天</span>
        </summary>
        {open && <AuditList />}
      </details>
    </section>
  );
}

function AuditList() {
  const { rows, more, error, reload, next } = usePaged<MembershipAuditView>(adminAudit);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!rows) return <Loading rows={3} />;
  if (!rows.length) return <p className="muted small">还没有记录。</p>;
  return (
    <ol className="madmin-log mono">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="faint">{when(r.createdAt)}</span>
          <b title={r.event}>{EVENT[r.event] ?? r.event}</b>
          <span className="madmin-log-details">{Object.entries(r.details ?? {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('  ')}</span>
        </li>
      ))}
      {more && (
        <li>
          <button className="text-btn" onClick={next}>
            更早的
          </button>
        </li>
      )}
    </ol>
  );
}
