import { coverOf, type SongInsight, type Track } from '../api';
import { authStore } from '../lib/account';
import { formatTime } from '../lib/format';
import { href } from '../lib/router';
import { groupCreators, styleTags } from '../lib/insight';
import { useStore } from '../lib/store';
import { playTrack } from '../player/player';
import { Cover } from './Cover';
import { Icon } from './Icon';

/**
 * 唱片内页：正在播放面板里和歌词二选一。
 * 写创作人员、曲风、副歌从哪里开始，和这首歌的原唱版本（当前放的是翻唱 / 现场版时）。
 */
export function LinerNotes({ track, insight, loading, onChorus }: { track: Track; insight?: SongInsight; loading: boolean; onChorus: () => void }) {
  const authorized = useStore(authStore, (s) => !!s.playbackAuthorization?.enabled);

  if (loading) {
    return (
      <div className="notes" aria-busy="true">
        <div className="skeleton" style={{ height: 18, width: '40%' }} />
        <div className="skeleton" style={{ height: 18, width: '64%', marginTop: 14 }} />
        <div className="skeleton" style={{ height: 18, width: '52%', marginTop: 14 }} />
      </div>
    );
  }

  const credits = groupCreators(insight?.creators ?? []);
  const tags = styleTags(insight?.wikiSummary);
  const originals = (insight?.alternatives ?? []).filter((t) => t.id !== track.id);
  const chorus = insight?.chorusStartMs;
  const empty = !credits.length && !tags.length && chorus == null && !originals.length;

  return (
    <div className="notes">
      {credits.length > 0 && (
        <dl className="notes-credits">
          {credits.map(([role, names], i) => (
            <div key={role} className="reveal" style={{ '--i': i } as React.CSSProperties}>
              <dt className="mono">{role}</dt>
              <dd>{names.join(' / ')}</dd>
            </div>
          ))}
        </dl>
      )}

      {tags.length > 0 && (
        <div className="notes-block">
          <span className="notes-label mono">曲风</span>
          <div className="notes-tags">
            {tags.map((t) => (
              <span key={t} className="notes-tag">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {chorus != null && (
        <div className="notes-block">
          <span className="notes-label mono">副歌</span>
          <button className="notes-chorus" onClick={onChorus}>
            从 {formatTime(chorus)} 开始听 <Icon name="arrow" size={16} />
          </button>
        </div>
      )}

      {originals.length > 0 && (
        <div className="notes-block">
          <span className="notes-label mono">原唱版本</span>
          {originals.map((t) => (
            <button key={t.id} className="notes-alt" onClick={() => playTrack(t)}>
              <Cover src={coverOf(t)} alt="" size={96} className="notes-alt-cover" />
              <span>
                <b>{t.name}</b>
                <small>{[t.artists.map((a) => a.name).join(' / '), t.album?.name].filter(Boolean).join(' · ')}</small>
              </span>
              <Icon name="play" size={16} />
            </button>
          ))}
        </div>
      )}

      {insight?.playable === false && !authorized && (
        <p className="notes-warn">
          原平台把这首标成了不能完整播放。开通会员后，会尝试换其他音源放完整版。
          <a className="text-btn" href={href.account()}>
            {' '}
            填会员邀请码 →
          </a>
        </p>
      )}

      {empty && <p className="lyrics-empty">这张唱片的内页是空白的。</p>}
    </div>
  );
}
