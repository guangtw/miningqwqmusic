import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { PlatformGlyph } from '../components/PlatformGlyph';
import { ErrorState } from '../components/States';
import {
  compareVersions,
  detectVisitor,
  fetchClientDownloads,
  formatBytes,
  orderFor,
  releaseDate,
  shortHash,
  type ClientPlatform,
  type Visitor,
} from '../lib/clientDownloads';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';

/** 每个平台自己的话：适用范围、比网页多出来的几样、怎么装。版本大小哈希不在这里，都从接口来 */
const NOTES: Record<string, { button: string; needs: string; perks: string[]; steps: { t: string; d: string }[] }> = {
  windows: {
    button: '下载安装包',
    needs: 'Windows 11 实测 · 需要 WebView2 运行时（Windows 11 自带）',
    perks: ['关掉窗口收进托盘，音乐不停', '托盘菜单里就能播放、暂停、切歌', '下载歌曲时弹「另存为」，自己选位置'],
    steps: [
      { t: '下载安装包', d: '文件名以 Setup.exe 结尾，存在浏览器默认的下载文件夹里。' },
      { t: '运行，放行一下', d: '安装包还没有代码签名，Windows 可能提示「已保护你的电脑」：点「更多信息」，再点「仍要运行」。' },
      { t: '装在你自己的账户下', d: '不需要管理员权限，可以顺手勾上桌面快捷方式。' },
      { t: '打开 Mining唱片行', d: '从开始菜单或桌面打开，登录后收藏和歌单照常同步。' },
    ],
  },
  android: {
    button: '下载 APK',
    needs: 'Android 8.0 及以上 · 通用安装包，不挑处理器',
    perks: ['全屏打开，没有地址栏和浏览器菜单', '下载的歌直接存进手机的下载目录', '登录后收藏和歌单照常同步'],
    steps: [
      { t: '下载 APK', d: '这是安装包本身，不是应用商店的链接。' },
      { t: '允许安装', d: '第一次从浏览器装应用时，系统会请你允许它「安装未知应用」，打开开关后返回。' },
      { t: '点「安装」', d: '以后有新版本，回到这一页下载新的 APK 装上就行。' },
      { t: '打开 Mining唱片行', d: '在桌面找到图标，登录后收藏和歌单照常同步。' },
    ],
  },
};

const UNINSTALLER = '%LOCALAPPDATA%\\Programs\\MiningQwQMusic\\unins000.exe';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast(`复制没成功，可以长按选中${what}手动复制。`);
    return false;
  }
}

/** 复制按钮：点了图标换成对勾弹一下 */
function CopyButton({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`dl-copy ${done ? 'done' : ''}`}
      aria-label={done ? `已复制${what}` : `复制${what}`}
      title={done ? '已复制' : `复制${what}`}
      onClick={async () => {
        if (!(await copy(text, what))) return;
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1800);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} key={String(done)} />
    </button>
  );
}

/** 一行可复制的命令或路径 */
function CopyLine({ text, what }: { text: string; what: string }) {
  return (
    <span className="dl-line">
      <code className="mono">{text}</code>
      <CopyButton text={text} what={what} />
    </span>
  );
}

function tagFor(p: ClientPlatform, v: Visitor): { text: string; hot?: boolean } | null {
  if (v.inClient === p.platform) {
    if (v.clientVersion && compareVersions(v.clientVersion, p.version) < 0) return { text: `有新版本 · 你的是 v${v.clientVersion}`, hot: true };
    return { text: v.clientVersion ? '你正在用 · 已是最新' : '你正在用' };
  }
  if (v.platform === p.platform && !v.inClient) return { text: '适合这台设备', hot: true };
  return null;
}

/** 一张封套：唱片从右边探出来一点；点下载时整张滑出来转起来，转几圈再收回去 */
function PlatformCard({ p, visitor, index }: { p: ClientPlatform; visitor: Visitor; index: number }) {
  const art = p.artifacts[0];
  const note = NOTES[p.platform];
  const tag = tagFor(p, visitor);
  const [spinning, setSpinning] = useState(false);
  const [tried, setTried] = useState(false);
  const [full, setFull] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const outdated = tag?.hot && visitor.inClient === p.platform;
  const size = art ? formatBytes(art.size) : '';
  const meta = [`v${p.version}`, p.architecture === 'universal' ? '' : p.architecture, size, releaseDate(p.publishedAt)].filter(Boolean);

  return (
    <article
      className={`dl-card reveal ${tag?.hot ? 'hot' : ''} ${spinning ? 'spinning' : ''}`}
      style={{ '--i': index + 1 } as React.CSSProperties}
      data-platform={p.platform}
      aria-labelledby={`dl-name-${p.platform}`}
    >
      <div className="dl-art" aria-hidden="true">
        <span className="dl-disc">
          <span className="dl-disc-face">
            <span className="dl-label">
              <PlatformGlyph platform={p.platform} size={14} />
            </span>
          </span>
        </span>
        <span className="dl-sleeve">
          <PlatformGlyph platform={p.platform} size={46} />
          <span className="dl-sleeve-ver mono">v{p.version}</span>
        </span>
      </div>

      <div className="dl-body">
        <div className="dl-title">
          <h2 id={`dl-name-${p.platform}`}>{p.name}</h2>
          {tag && <span className={`dl-tag mono ${tag.hot ? 'hot' : ''}`}>{tag.text}</span>}
        </div>
        <div className="dl-meta mono">
          {meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
        {note && <p className="dl-needs">{note.needs}</p>}
        {note && (
          <ul className="dl-perks">
            {note.perks.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}

        <div className="dl-act">
          <a
            className={`btn ${tag?.hot || !tag ? 'solid' : ''} dl-go`}
            href={p.downloadUrl}
            // 带上 download：万一出错也只是一条失败的下载，不会把整页（和正在放的歌）带走；
            // 文件名给全，Android 客户端拦下 a[download] 交给系统下载时才不会叫成「android」
            download={art?.fileName ?? true}
            onClick={() => {
              // 不拦默认行为：稳定入口 307 到本站文件，浏览器自己接管下载
              setTried(true);
              setSpinning(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setSpinning(false), 4200);
            }}
          >
            <span className="dl-go-face" key={String(spinning)}>
              <Icon name={spinning ? 'check' : 'download'} />
              {spinning ? '已交给浏览器下载' : outdated ? `更新到 v${p.version}` : note?.button ?? '下载'}
            </span>
            {!spinning && size && <span className="dl-go-size mono">{size}</span>}
          </a>
          <span className="sr-only" aria-live="polite">
            {spinning ? `${p.name} 安装包已开始下载，留意浏览器的下载栏。` : ''}
          </span>
        </div>
        {tried && art && (
          <p className="dl-retry help">
            浏览器没有动静？{' '}
            <a className="link" href={art.url} download={art.fileName}>
              用 v{p.version} 的直链再试一次
            </a>
          </p>
        )}

        {art && (
          <div className="dl-hash">
            <span className="mono faint">SHA-256</span>
            <button
              type="button"
              className={`dl-hash-v mono ${full ? 'open' : ''}`}
              aria-expanded={full}
              title={full ? '收起' : '展开完整指纹'}
              onClick={() => setFull((x) => !x)}
            >
              {full ? art.sha256 : shortHash(art.sha256)}
            </button>
            <CopyButton text={art.sha256} what={`${p.name} 安装包的 SHA-256`} />
          </div>
        )}
      </div>
    </article>
  );
}

function CardSkeleton({ i }: { i: number }) {
  return (
    <div className="dl-card dl-card-skel reveal" style={{ '--i': i } as React.CSSProperties} aria-hidden="true">
      <div className="dl-art">
        <span className="dl-sleeve skeleton" />
      </div>
      <div className="dl-body">
        <div className="skeleton" style={{ height: 30, width: '46%' }} />
        <div className="skeleton" style={{ height: 14, width: '70%', marginTop: 14 }} />
        <div className="skeleton" style={{ height: 14, width: '58%', marginTop: 10 }} />
        <div className="skeleton" style={{ height: 42, width: 168, marginTop: 24, borderRadius: 999 }} />
      </div>
    </div>
  );
}

/** 装上它：Windows / Android 两套步骤，切换时一站一站重新浮上来 */
function Steps({ platforms, initial }: { platforms: ClientPlatform[]; initial: string | null }) {
  const choices = platforms.filter((p) => NOTES[p.platform]);
  const [tab, setTab] = useState(() => (initial && choices.some((p) => p.platform === initial) ? initial : choices[0]?.platform));
  if (!tab) return null;
  const steps = NOTES[tab].steps;
  return (
    <section className="qa-sec reveal" style={{ '--i': 4 } as React.CSSProperties} aria-labelledby="dl-steps">
      <div className="qa-h dl-steps-head">
        <h2 id="dl-steps">装上它</h2>
        {choices.length > 1 && (
          <div className="seg" role="radiogroup" aria-label="安装步骤">
            {choices.map((p) => (
              <button key={p.platform} role="radio" aria-checked={tab === p.platform} className={tab === p.platform ? 'on' : ''} onClick={() => setTab(p.platform)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <ol className="qa-path dl-path" key={tab}>
        {steps.map((s, i) => (
          <li key={s.t} className={`reveal ${i === steps.length - 1 ? 'end' : ''}`} style={{ '--i': i } as React.CSSProperties}>
            <span className="qa-step mono">{String(i + 1).padStart(2, '0')}</span>
            <b>{s.t}</b>
            <span>{s.d}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * 客户端下载。从设置里的「客户端」点进来，也可以直接分享 #/download。
 * 推荐这台设备能用的那个；在客户端里打开时标出正在用的（Android 还能比一下版本）。
 */
export function DownloadView({ topic }: { topic: string }) {
  const visitor = useMemo(() => detectVisitor(), []);
  const { data, error, loading, reload } = useAsync((signal) => fetchClientDownloads(signal), []);
  const platforms = useMemo(() => orderFor(data?.platforms ?? [], visitor.platform), [data, visitor.platform]);
  const windowsFile = data?.platforms.find((p) => p.platform === 'windows')?.artifacts[0]?.fileName;

  useEffect(() => {
    if (!topic || loading) return;
    document.getElementById(`dl-${topic}`)?.scrollIntoView({ block: 'start' });
  }, [topic, loading]);

  return (
    <div className="page qa-page dl-page">
      <header className="page-head reveal">
        <div className="kicker">客户端 · 下载</div>
        <h1 className="page-title">带一台唱机回家</h1>
        <p className="qa-lead">
          客户端打开的就是这家唱片行：同一个账号、同样的歌单和音质，只是不用再开浏览器、翻标签页。Windows 版关了窗口还能在托盘里接着放。
        </p>
      </header>

      {visitor.apple && (
        <p className="dl-apple reveal" style={{ '--i': 1 } as React.CSSProperties}>
          <b>iPhone、iPad 和 Mac 暂时没有客户端。</b>
          在 Safari 里点分享，再点「添加到主屏幕」，就能像应用一样从桌面打开。
        </p>
      )}

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="dl-grid" aria-busy={loading}>
          {loading ? [1, 2].map((i) => <CardSkeleton key={i} i={i} />) : platforms.map((p, i) => <PlatformCard key={p.platform} p={p} visitor={visitor} index={i} />)}
        </div>
      )}

      {data && <Steps platforms={platforms} initial={visitor.inClient ? null : visitor.platform} />}

      <section className="qa-sec reveal" style={{ '--i': 5 } as React.CSSProperties} aria-labelledby="dl-faq">
        <h2 id="dl-faq" className="qa-h">常见问题</h2>
        <dl className="qa-list">
          <div id="dl-uninstall" className={`qa-item ${topic === 'uninstall' ? 'on' : ''}`}>
            <dt>怎么卸载？</dt>
            <dd>
              <p>
                <b>Windows：</b>打开「设置 → 应用 → 已安装的应用」，找到 Mining唱片行 卸载。列表里找不到时，按 Win + R，粘贴下面的路径回车，运行它自带的卸载程序：
              </p>
              <CopyLine text={UNINSTALLER} what="卸载程序路径" />
              <p>别直接删安装文件夹，卸载程序也在里面，删了就没法正常卸载了。卸载不会清掉客户端的登录和设置，装回来还在。</p>
              <p>
                <b>Android：</b>和其他应用一样长按图标卸载。应用里的登录状态会一起删掉，重装后再登录就好，收藏和歌单在账号里，不会丢。
              </p>
            </dd>
          </div>
          <div id="dl-verify" className={`qa-item ${topic === 'verify' ? 'on' : ''}`}>
            <dt>怎么确认安装包是完整的？</dt>
            <dd>
              <p>每个安装包下面都有一串 SHA-256 指纹。在 Windows 上打开 PowerShell 运行下面这行，算出来的和页面上的一样，就说明文件完整、没被改过：</p>
              <CopyLine text={`Get-FileHash "$env:USERPROFILE\\Downloads\\${windowsFile ?? '安装包文件名'}"`} what="校验命令" />
            </dd>
          </div>
          <div id="dl-update" className={`qa-item ${topic === 'update' ? 'on' : ''}`}>
            <dt>客户端要经常更新吗？</dt>
            <dd>
              <p>不用。界面和功能跟着网站走，网站更新后，客户端下次打开就是新的。只有客户端本身有改动时才会发新安装包，这一页放的永远是最新版。</p>
            </dd>
          </div>
          <div id="dl-windows" className={`qa-item ${topic === 'windows' ? 'on' : ''}`}>
            <dt>Windows 10 或 ARM 电脑能用吗？</dt>
            <dd>
              <p>目前只有 x64 版本，在 Windows 11 上实测过。Windows 10 还没在真机上验证，系统里装了 WebView2 运行时的话可以试试。</p>
            </dd>
          </div>
          <div id="dl-apple" className={`qa-item ${topic === 'apple' ? 'on' : ''}`}>
            <dt>有 iPhone、iPad 或 Mac 版吗？</dt>
            <dd>
              <p>暂时没有。iPhone 和 iPad 上用 Safari 打开这个网站，点分享 → 「添加到主屏幕」，就能从桌面直接打开；Mac 上直接用浏览器就好。</p>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
