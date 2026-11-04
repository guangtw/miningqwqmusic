import { useEffect, useSyncExternalStore } from 'react';
import { qualities, type QualityOption } from '../config/site';
import { QualityMark } from '../components/QualityMark';
import { getSettings, subscribeSettings } from '../lib/settings';
import { href } from '../lib/router';
import type { PlayQualityLevel } from '../api';

const opt = (k: PlayQualityLevel) => qualities.find((q) => q.key === k) as QualityOption;

/** 放错是怎么一步步发生的：真是一条先后顺序，所以编号 */
const PATH = [
  { t: '原平台只给到「极高」', d: '网易云对不少免费歌只提供到 320 kbps 的「极高」。' },
  { t: '你选了更高的音质', d: '在这样的歌上换成无损或更高，播放器会记下「优先完整音源」，以后先去其他音源找你选的档位。' },
  { t: '去其他音源找同一首', d: '其他音源按歌名、歌手这些信息去对应，曲库和网易云并不完全一致。' },
  { t: '偶尔对到了别的版本', d: '翻唱、现场版、伴奏，或者同名的另一首歌，就这样被当成了你点的那首。' },
];

const QA: { id: string; q: string; a: React.ReactNode }[] = [
  {
    id: 'when',
    q: '什么情况下最容易遇到？',
    a: (
      <>
        <p>免费歌，音质选的是「超清母带」。目前收到的反馈里，放错的情况大多集中在这个组合上。</p>
        <p>其他高音质（无损、Hi-Res、环绕声这些）也可能遇到，但少得多。会员歌和单独付费的歌不在这个范围里。</p>
      </>
    ),
  },
  {
    id: 'switch',
    q: '点了「切回稳定音源」会怎样？',
    a: (
      <>
        <p>这一首改用网易云原平台的音源，从刚才的位置接着放；暂停着的也还是暂停。</p>
        <p>原平台对免费歌一般只给到「极高」，所以这首的音质会落到极高。只影响这一首：切到下一首、重新点播或刷新页面后，照常按你的设置去找音源。</p>
      </>
    ),
  },
  {
    id: 'quality',
    q: '不想停在「极高」，又不想听错歌？',
    a: (
      <>
        <p>
          把音质换成超清母带以外的高档位，比如 <b>Hi-Res</b> 或 <b>无损</b>。这些档位放错的情况少很多，音质也比极高好。
        </p>
        <p>点播放台上的音质标签就能换，正在放的歌会从当前位置按新音质接着放。</p>
      </>
    ),
  },
  {
    id: 'off',
    q: '想以后都先用原平台？',
    a: (
      <>
        <p>
          去 <a className="link" href={href.settings()}>设置</a> 的「音源」一栏，关掉「优先完整音源」。之后放的歌先用原平台音源，原平台放不了完整版时才换。正在放的这首不受影响。
        </p>
      </>
    ),
  },
  {
    id: 'still',
    q: '切回来还是放不了，或者只有试听？',
    a: (
      <p>稳定音源就是原平台。这首在原平台有版权或地区限制时，切回来也可能只能试听，甚至放不了。想回到刚才的完整版，重新点播这首就行。</p>
    ),
  },
  {
    id: 'sure',
    q: '「稳定音源」一定是原曲吗？',
    a: <p>绝大多数时候是。但它的意思是走网易云自己的链路，并不是逐首核对过录音，所以不能百分百保证。</p>,
  },
  {
    id: 'device',
    q: '这些设置会跟着账号走吗？',
    a: <p>不会。「优先完整音源」只记在这台设备的这个浏览器里，换手机或换浏览器要重新选。「切回稳定音源」更短，只管当前这一首。</p>,
  },
];

/**
 * 问与答。眼下只有一节：放的歌不对。从「已切回稳定音源」后面的 Q&A 点进来。
 * topic：进来时滚到哪一问（例如 ?q=quality）；source 就是整页，从头看。
 */
export function HelpView({ topic }: { topic: string }) {
  const chosen = useSyncExternalStore(subscribeSettings, () => getSettings().quality);

  useEffect(() => {
    if (!topic || topic === 'source') return;
    document.getElementById(`qa-${topic}`)?.scrollIntoView({ block: 'start' });
  }, [topic]);

  return (
    <div className="page qa-page">
      <header className="page-head reveal">
        <div className="kicker">Q&amp;A · 播放</div>
        <h1 className="page-title">放的歌不对？</h1>
        <p className="qa-lead">
          点开一首免费歌，放出来的却是翻唱、现场版、伴奏，或者干脆是另一首同名的歌。这一页说清楚它为什么会发生、什么时候最常见，以及怎么处理。
        </p>
      </header>

      <section className="qa-sec reveal" style={{ '--i': 1 } as React.CSSProperties} aria-labelledby="qa-why">
        <h2 id="qa-why" className="qa-h">怎么会放错</h2>
        <ol className="qa-path">
          {PATH.map((s, i) => (
            <li key={s.t} className={i === PATH.length - 1 ? 'end' : ''}>
              <span className="qa-step mono">{String(i + 1).padStart(2, '0')}</span>
              <b>{s.t}</b>
              <span>{s.d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="qa-sec reveal" style={{ '--i': 2 } as React.CSSProperties} aria-labelledby="qa-levels">
        <h2 id="qa-levels" className="qa-h">哪个音质最常见</h2>
        <div className="qa-levels">
          <div className="qa-level hot">
            <QualityMark option={opt('jymaster')} size="md" withLabel />
            <span>放错大多集中在这里</span>
            {chosen === 'jymaster' && <em className="mono">你现在选的</em>}
          </div>
          <div className="qa-level">
            <span className="qa-marks">
              <QualityMark option={opt('hires')} size="md" />
              <QualityMark option={opt('lossless')} size="md" />
            </span>
            <span>偶尔会有，少得多；想要高音质又少踩坑，选这两档</span>
            {(chosen === 'hires' || chosen === 'lossless') && <em className="mono">你现在选的</em>}
          </div>
          <div className="qa-level">
            <span className="qa-marks">
              <QualityMark option={opt('exhigh')} size="md" />
            </span>
            <span>点了「切回稳定音源」之后，免费歌一般落在这一档</span>
          </div>
        </div>
      </section>

      <section className="qa-sec reveal" style={{ '--i': 3 } as React.CSSProperties} aria-labelledby="qa-list">
        <h2 id="qa-list" className="qa-h">常见问题</h2>
        <dl className="qa-list">
          {QA.map((x) => (
            <div key={x.id} id={`qa-${x.id}`} className={`qa-item ${topic === x.id ? 'on' : ''}`}>
              <dt>{x.q}</dt>
              <dd>{x.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
