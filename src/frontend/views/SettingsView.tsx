import { useRef, useSyncExternalStore } from 'react';
import { music } from '../api';
import { api } from '../config/site';
import { Icon } from '../components/Icon';
import { PlatformGlyph } from '../components/PlatformGlyph';
import { QualityPicker } from '../components/QualityPicker';
import { setQuality } from '../player/player';
import { authStore } from '../lib/account';
import { isNativeClient } from '../lib/clientDownloads';
import { transition } from '../lib/motion';
import { getSettings, subscribeSettings, updateSettings, type Settings, type Theme } from '../lib/settings';
import { href } from '../lib/router';
import { recoveryStore, setRecoveryHints } from '../lib/sourceRecovery';
import { useStore } from '../lib/store';
import { useAsync } from '../lib/useAsync';

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
  return (
    <div className="page">
      <header className="page-head reveal">
        <div className="kicker">设置</div>
        <h1 className="page-title">唱机调校</h1>
      </header>
      <SettingsPanel />
    </div>
  );
}

/** 设置项本体：单独的设置页和手机上个人中心的「设置」分页共用 */
export function SettingsPanel() {
  const s = useSyncExternalStore(subscribeSettings, getSettings);
  const status = useStore(authStore, (x) => x.status);
  // 用推荐接口探一下 BFF 是否可用
  const probe = useAsync(() => music.searchAssist(''), []);

  return (
    <>
      <div className="form">
        <div className="field reveal" style={{ '--i': 0 } as React.CSSProperties}>
          <span className="label">音质</span>
          <div>
            <div className="qp-standalone">
              <QualityPicker value={s.quality} onPick={setQuality} />
            </div>
            <p className="help">立即生效：正在放的歌会从当前位置按新音质接着放。账号权限或音源不够时，后端会自动降到可用的最高一档。</p>
          </div>
        </div>

        <SourceField />

        <div className="field reveal" style={{ '--i': 2 } as React.CSSProperties}>
          <span className="label">外观</span>
          <Seg value={s.theme} options={THEMES} onChange={(theme) => transition(() => updateSettings({ theme }), 'theme')} label="外观" />
        </div>

        <div className="field reveal" style={{ '--i': 3 } as React.CSSProperties}>
          <span className="label">动画</span>
          <div>
            <Seg value={s.motion} options={MOTIONS} onChange={(motion) => updateSettings({ motion })} label="动画" />
            <p className="help">系统开启了「减少动态效果」时会自动精简。</p>
          </div>
        </div>

        {!isNativeClient() && <div className="field reveal" style={{ '--i': 4 } as React.CSSProperties}>
          <span className="label">客户端</span>
          <a className="dl-entry" href={href.download()}>
            <span className="dl-entry-glyphs" aria-hidden="true">
              <PlatformGlyph platform="windows" size={18} />
              <PlatformGlyph platform="android" size={18} />
            </span>
            <span className="dl-entry-text">
              <b>下载客户端</b>
              <small>Windows 和 Android，登录后歌单照常同步</small>
            </span>
            <Icon name="arrow" />
          </a>
        </div>}

        <div className="field reveal" style={{ '--i': 5 } as React.CSSProperties}>
          <span className="label">后端</span>
          <div>
            <div className="field-inline">
              <span className={`status-dot ${probe.loading ? '' : probe.error ? 'bad' : 'ok'}`} />
              <span className="small">{probe.loading ? '连接中…' : probe.error ? probe.error.message : '已连接'}</span>
              <span className="mono faint">{api.base || '同源 /api'}</span>
            </div>
            {/* 账号相关都在个人中心（点侧栏头像），这里只报账户服务有没有开 */}
            {status === 'unavailable' && <p className="help">后端未启用账户服务，收藏只保存在本机。</p>}
          </div>
        </div>
      </div>

      <section className="section keys-section">
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
    </>
  );
}

/**
 * 优先完整音源：在原平台给出完整「极高」的歌上手动换到无损或更高音质时，播放器自动打开并记在这台设备上。
 * 这里只给关掉的地方，不提供凭空打开；这一页上刚关掉的，可以再拨回去。
 */
function SourceField() {
  const on = useSyncExternalStore(subscribeSettings, () => getSettings().preferUnblock);
  const seen = useRef(on);
  if (on) seen.current = true;
  const muted = useStore(recoveryStore, (s) => s.muted);
  return (
    <div className="field reveal" style={{ '--i': 1 } as React.CSSProperties}>
      <span className="label">音源</span>
      <div>
        <div className="madmin-switch pref-switch">
          <span>
            <b>优先完整音源</b>
            <small>{on ? '已开启：这台设备上的歌会先找其他音源的完整版。' : '未开启：先用原平台音源，放不了完整版才换。'}</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="优先完整音源"
            className={`switch ${on ? 'on' : ''}`}
            disabled={!seen.current}
            onClick={() => updateSettings({ preferUnblock: !on })}
          >
            <i />
          </button>
        </div>
        <p className="help">
          {seen.current
            ? '只影响之后放的歌，正在放的这首不打断。某首放得不对时，打开音质面板可以临时换回原平台音源。'
            : '放原平台「极高」音质的歌时，把音质换成无损或更高，会自动打开。只记在这台设备上。'}{' '}
          <a className="link" href={href.help('source')}>
            放的歌不对？看 Q&amp;A
          </a>
        </p>
        {muted && (
          <p className="help">
            歌名附近的「放的歌不对？」提醒已关掉，音质面板里的入口还在。{' '}
            <button type="button" className="link" onClick={() => setRecoveryHints(true)}>
              重新显示提醒
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
