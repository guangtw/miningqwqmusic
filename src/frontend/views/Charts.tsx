import { music } from '../api';
import { Cover } from '../components/Cover';
import { ErrorState, Loading } from '../components/States';
import { artistNames } from '../lib/format';
import { markHero, setPreview } from '../lib/motion';
import { href } from '../lib/router';
import { useAsync } from '../lib/useAsync';

/** 榜单页：每张榜单带前三名预览 */
export function Charts() {
  const { data, error, loading, reload } = useAsync(() => music.toplists(), [], 'toplists');
  return (
    <div className="page">
      <header className="page-head reveal">
        <div className="kicker">排行</div>
        <h1 className="page-title">榜单</h1>
      </header>
      {loading && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      <div className="toplists">
        {data?.map((t, i) => {
          const key = `toplist:${t.id}`;
          return (
            <a
              key={t.id}
              href={href.toplist(t.id)}
              className="toplist reveal"
              style={{ '--i': i } as React.CSSProperties}
              onClick={(e) => {
                markHero(e.currentTarget.querySelector<HTMLElement>('.sleeve'), key);
                setPreview(key, { title: t.name, coverUrl: t.coverUrl });
              }}
            >
              <Cover src={t.coverUrl} alt="" size={240} className="sleeve" />
              <div className="toplist-body">
                <div className="toplist-head">
                  <b>{t.name}</b>
                  {t.updateFrequency && <span className="mono faint">{t.updateFrequency}</span>}
                </div>
                {/* 有的后端不给前三名预览，那就显示榜单简介 */}
                {!t.tracksPreview.length && t.description && <p className="toplist-desc">{t.description}</p>}
                <ol>
                  {t.tracksPreview.slice(0, 3).map((tr, k) => (
                    <li key={tr.id}>
                      <span className="mono">{k + 1}</span>
                      <span className="ell">
                        {tr.name}
                        <span className="faint"> — {artistNames(tr.artists)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
