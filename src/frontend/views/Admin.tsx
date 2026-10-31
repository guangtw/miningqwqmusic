import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Empty, ErrorState, Loading } from '../components/States';
import { authStore } from '../lib/account';
import { grantAuthorization, listAuthorizedUsers, revokeAuthorization, type AuthorizedUser } from '../lib/membership';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';

const nameOf = (u: AuthorizedUser) => u.nickname || u.email.split('@')[0];

function stateText(u: AuthorizedUser) {
  const a = u.playbackAuthorization;
  if (!a.enabled) return '未授权';
  const when = a.grantedAt ? ` · ${a.grantedAt.slice(0, 10)}` : '';
  return a.source === 'invite' ? `兑换码${a.inviteLabel ? `「${a.inviteLabel}」` : ''}${when}` : `手动开通${when}`;
}

/** 授权管理（仅管理员）：按邮箱或昵称找人，开通 / 撤销播放授权 */
export function AdminView() {
  const status = useStore(authStore, (s) => s.status);
  const role = useStore(authStore, (s) => s.user?.role);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AuthorizedUser[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const allowed = status === 'authenticated' && role === 'admin';

  // 输入停 300ms 再查；新的查询会取消上一个
  useEffect(() => {
    if (!allowed) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setError(null);
      listAuthorizedUsers(q, ctrl.signal).then(setRows, (e) => {
        if ((e as Error).name !== 'AbortError') setError(e as Error);
      });
    }, q ? 300 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, allowed, tick]);

  const flip = async (u: AuthorizedUser) => {
    setBusy(u.id);
    try {
      const snap = u.playbackAuthorization.enabled ? await revokeAuthorization(u.id) : await grantAuthorization(u.id);
      setRows((rs) => rs?.map((r) => (r.id === u.id ? { ...r, playbackAuthorization: snap } : r)) ?? rs);
      toast(snap.enabled ? `给 ${nameOf(u)} 开通了。` : `撤销了 ${nameOf(u)} 的授权。`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (status === 'checking') return <div className="page"><Loading /></div>;
  if (!allowed) {
    return (
      <div className="page">
        <Empty title="这一页只对管理员开放">
          <a className="btn" href={href.settings()} style={{ marginTop: 18 }}>
            回设置
          </a>
        </Empty>
      </div>
    );
  }

  const granted = rows?.filter((r) => r.playbackAuthorization.enabled).length ?? 0;

  return (
    <div className="page">
      <header className="page-head reveal">
        <div className="kicker">管理</div>
        <h1 className="page-title">授权管理</h1>
        <p className="muted small" style={{ marginTop: 14 }}>
          开通后对方可以放灰色歌曲。改动立刻生效，对方正在放的歌会按新权限重新取音源。
        </p>
      </header>

      <div className="admin-bar reveal" style={{ '--i': 1 } as React.CSSProperties}>
        <label className="admin-search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按邮箱或昵称找人" aria-label="搜索用户" />
        </label>
        {rows && (
          <span className="mono faint small">
            {rows.length} 人{rows.length === 50 ? '（最多显示 50）' : ''} · 已授权 {granted}
          </span>
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title="没找到这个人">
          <p className="muted">试试邮箱的一部分。</p>
        </Empty>
      ) : (
        <div className="admin-list" role="list">
          {rows.map((u, i) => (
            <div key={u.id} role="listitem" className={`admin-row ${i < 24 ? 'reveal' : ''}`} style={{ '--i': i } as React.CSSProperties}>
              <span className="admin-initial" aria-hidden="true">
                {nameOf(u).slice(0, 1).toUpperCase()}
              </span>
              <span className="admin-who">
                <span className="t">
                  {nameOf(u)}
                  {u.role === 'admin' && <span className="admin-tag mono">管理员</span>}
                </span>
                <span className="a">{u.email}</span>
              </span>
              <span className={`admin-state ${u.playbackAuthorization.enabled ? 'on' : ''}`}>{stateText(u)}</span>
              <button
                className={`btn sm ${u.playbackAuthorization.enabled ? '' : 'solid'}`}
                disabled={busy === u.id}
                onClick={() => void flip(u)}
              >
                {busy === u.id ? '处理中…' : u.playbackAuthorization.enabled ? '撤销' : '开通'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
