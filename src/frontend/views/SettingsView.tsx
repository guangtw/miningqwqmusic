import { useSyncExternalStore } from 'react';
import { music } from '../api';
import { api, qualities } from '../config/site';
import { authStore, displayName, logout } from '../lib/account';
import { transition } from '../lib/motion';
import { getSettings, subscribeSettings, updateSettings, type Settings, type Theme } from '../lib/settings';
import { useStore } from '../lib/store';
import { useAsync } from '../lib/useAsync';
import { uiStore } from '../player/ui';

const THEMES: { key: Theme; label: string }[] = [
  { key: 'auto', label: '跟随系统' },
  { key: 'paper', label: '日间' },
  { key: 'night', label: '夜间' },
];

const MOTIONS: { key: Settings['motion']; label: string }[] = [
  { key: 'full', label: '完整' },
  { key: 'reduced', label: '精简' },
];

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView() {
  const s = useSyncExternalStore(subscribeSettings, getSettings);
  const status = useStore(authStore, (x) => x.status);
  const user = useStore(authStore, (x) => x.user);
  // 用推荐接口探一下 BFF 是否可用
  const probe = useAsync(() => music.searchAssist(''), []);

  return (
    <div className="page">
      <header className="page-head reveal">
        <div className="kicker">设置</div>
        <h1 className="page-title">唱机调校</h1>
      </header>

      <div className="form">
        <div className="field reveal" style={{ '--i': 0 } as React.CSSProperties}>
          <span className="label">音质</span>
          <div>
            <Seg value={s.quality} options={qualities} onChange={(quality) => updateSettings({ quality })} label="音质" />
            <p className="help">下一首开始生效。账号没有对应权限时，后端会自动降到可用的音质。</p>
          </div>
        </div>

        <div className="field reveal" style={{ '--i': 1 } as React.CSSProperties}>
          <span className="label">外观</span>
          <Seg value={s.theme} options={THEMES} onChange={(theme) => transition(() => updateSettings({ theme }), 'theme')} label="外观" />
        </div>

        <div className="field reveal" style={{ '--i': 2 } as React.CSSProperties}>
          <span className="label">动画</span>
          <div>
            <Seg value={s.motion} options={MOTIONS} onChange={(motion) => updateSettings({ motion })} label="动画" />
            <p className="help">系统开启了「减少动态效果」时会自动精简。</p>
          </div>
        </div>

        <div className="field reveal" style={{ '--i': 3 } as React.CSSProperties}>
          <span className="label">账号</span>
          <div className="field-inline">
            {status === 'authenticated' && user ? (
              <>
                <span>{displayName(user)}</span>
                <span className="muted small">{user.email}</span>
                <button className="btn sm" onClick={logout}>
                  退出登录
                </button>
              </>
            ) : status === 'guest' ? (
              <button className="btn sm" onClick={() => uiStore.set({ login: true })}>
                登录同步
              </button>
            ) : status === 'unavailable' ? (
              <span className="muted small">后端未启用账户服务，收藏只保存在本机。</span>
            ) : (
              <span className="muted small">检查中…</span>
            )}
          </div>
        </div>

        <div className="field reveal" style={{ '--i': 4 } as React.CSSProperties}>
          <span className="label">后端</span>
          <div className="field-inline">
            <span className={`status-dot ${probe.loading ? '' : probe.error ? 'bad' : 'ok'}`} />
            <span className="small">{probe.loading ? '连接中…' : probe.error ? probe.error.message : '已连接'}</span>
            <span className="mono faint">{api.base || '同源 /api'}</span>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>快捷键</h2>
        </div>
        <dl className="keys">
          <dt>空格</dt>
          <dd>播放 / 暂停</dd>
          <dt>← →</dt>
          <dd>后退 / 前进 5 秒</dd>
          <dt>Shift + ← →</dt>
          <dd>上一首 / 下一首</dd>
          <dt>L</dt>
          <dd>打开唱机和歌词</dd>
          <dt>/</dt>
          <dd>搜索</dd>
        </dl>
      </section>
    </div>
  );
}
