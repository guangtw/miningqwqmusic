import { Fragment } from 'react';
import { hasId, type Track } from '../api';
import { libraryStore, toggleFavorite } from '../lib/account';
import { formatTime, sideLabel } from '../lib/format';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { addNext, currentTrack, playerStore, playList, toggle } from '../player/player';
import { Equalizer } from './Equalizer';
import { HeartButton } from './HeartButton';
import { Icon } from './Icon';

interface Props {
  tracks: Track[];
  /** 专辑按 A/B 面编号，歌单按 01、02 编号 */
  sides?: boolean;
  showAlbum?: boolean;
}

/** 入场动画只给前若干行，长列表后面的直接出现 */
const STAGGER_ROWS = 24;

export function TrackList({ tracks, sides = false, showAlbum = true }: Props) {
  const current = useStore(playerStore, (s) => currentTrack(s)?.id);
  const playing = useStore(playerStore, (s) => s.playing);
  const favorites = useStore(libraryStore, (s) => s.favorites);
  const half = Math.ceil(tracks.length / 2);

  const onRow = (i: number) => {
    if (tracks[i].id === current) toggle();
    else playList(tracks, i);
  };

  return (
    <div className={`tracks ${showAlbum ? '' : 'no-album'}`} role="list">
      <div className="tracks-head mono" aria-hidden="true">
        <span>{sides ? '面' : '序'}</span>
        <span>曲名</span>
        <span className="col-artist">艺人</span>
        {showAlbum && <span className="col-album">专辑</span>}
        <span />
        <span style={{ textAlign: 'right' }}>时长</span>
      </div>
      {tracks.map((t, i) => {
        const isCur = t.id === current;
        const liked = t.id in favorites;
        return (
          <Fragment key={`${t.id}-${i}`}>
            {sides && tracks.length > 3 && (i === 0 || i === half) && (
              <div className="side-divider reveal" style={{ '--i': Math.min(i, STAGGER_ROWS) } as React.CSSProperties}>
                {i === 0 ? 'A 面' : 'B 面'}
              </div>
            )}
            <div
              role="listitem"
              className={`track ${i < STAGGER_ROWS ? 'reveal' : ''} ${isCur ? 'current' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => onRow(i)}
            >
              <span className="no">
                {isCur ? (
                  <Equalizer playing={playing} />
                ) : (
                  <>
                    <span className="label">{sides ? sideLabel(i, tracks.length) : String(i + 1).padStart(2, '0')}</span>
                    <span className="play-hint">
                      <Icon name="play" />
                    </span>
                  </>
                )}
              </span>
              <span className="name">
                <span className="t">{t.name}</span>
              </span>
              <span className="cell col-artist">
                {t.artists.map((a, k) => (
                  <Fragment key={`${a.id}-${k}`}>
                    {k > 0 && ' / '}
                    {hasId(a.id) ? (
                      <a href={href.artist(a.id)} onClick={(e) => e.stopPropagation()}>
                        {a.name}
                      </a>
                    ) : (
                      a.name
                    )}
                  </Fragment>
                ))}
              </span>
              {showAlbum && (
                <span className="cell col-album">
                  {hasId(t.album?.id) ? (
                    <a href={href.album(t.album.id)} onClick={(e) => e.stopPropagation()}>
                      {t.album.name}
                    </a>
                  ) : (
                    t.album?.name
                  )}
                </span>
              )}
              <span className="row-actions">
                <HeartButton liked={liked} onToggle={() => toggleFavorite(t)} />
              </span>
              <span className="dur">
                <button
                  className="icon-btn add"
                  aria-label="下一首播放"
                  title="下一首播放"
                  onClick={(e) => {
                    e.stopPropagation();
                    addNext(t);
                  }}
                >
                  <Icon name="plus" />
                </button>
                <span className="hide-on-hover">{formatTime(t.durationMs)}</span>
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
