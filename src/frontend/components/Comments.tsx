import { memo, useEffect, useRef, useState } from 'react';
import type { TrackComment, TrackCommentAuthor } from '@/src/types/music';
import { avatarSrc, commentTime, useComments, type CommentSort } from '../lib/comments';
import { formatCount } from '../lib/format';
import { Icon } from './Icon';

/**
 * 歌曲评论：正在播放面板里和歌词、唱片内页三选一。网易云的公开评论，只能看。
 * 正文一律当纯文本渲染。滚到底自动翻下一页。
 */
export function Comments({ trackId, onTotal }: { trackId: string; onTotal?: (n: number | null) => void }) {
  const [sort, setSort] = useState<CommentSort>('hot');
  const c = useComments(trackId, sort, true);
  const boxRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { more } = c;
  const loaded = !c.loading || c.items.length > 0;

  useEffect(() => {
    onTotal?.(c.items.length || !c.hasMore ? c.total : null);
  }, [c.total, c.items.length, c.hasMore, onTotal]);

  // 换歌、换排序：回到顶上
  useEffect(() => {
    boxRef.current?.scrollTo({ top: 0 });
  }, [trackId, sort]);

  useEffect(() => {
    const el = endRef.current;
    if (!el || !c.hasMore || c.error) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && more(), { root: boxRef.current, rootMargin: '0px 0px 320px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, c.hasMore, c.error, c.items.length]);

  return (
    <div className="comments" ref={boxRef}>
      <div className="cmt-head">
        <div className="seg seg-sm" role="tablist" aria-label="评论排序">
          {(['hot', 'time'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={sort === s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
              {s === 'hot' ? '最热' : '最新'}
            </button>
          ))}
        </div>
        {loaded && c.total > 0 && <span className="cmt-total mono">{c.total.toLocaleString('zh-CN')} 条</span>}
      </div>

      {/* 换排序时整列重新入场 */}
      <div className="cmt-list" key={sort}>
        {c.items.map((x, i) => (
          <CommentItem key={x.id} c={x} i={i} />
        ))}
      </div>

      {c.loading && (
        <div className="cmt-loading" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="cmt-skel">
              <span className="skeleton" />
              <div>
                <div className="skeleton" style={{ height: 12, width: '30%' }} />
                <div className="skeleton" style={{ height: 15, width: `${82 - i * 14}%`, marginTop: 10 }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {c.error && (
        <p className="cmt-state">
          {c.error}
          <button className="text-btn" onClick={c.retry}>
            重试
          </button>
        </p>
      )}
      {!c.loading && !c.error && !c.items.length && <p className="cmt-state">还没有人留言。</p>}
      {!c.loading && !c.error && c.items.length > 0 && !c.hasMore && <p className="cmt-end mono">就这些了</p>}
      <div ref={endRef} className="cmt-sentinel" aria-hidden="true" />
    </div>
  );
}

function Face({ author, size }: { author: TrackCommentAuthor; size: number }) {
  const [broken, setBroken] = useState(false);
  const src = avatarSrc(author.avatarUrl);
  if (src && !broken) return <img className="avatar cmt-avatar" src={src} alt="" loading="lazy" style={{ width: size, height: size }} onError={() => setBroken(true)} />;
  return (
    <span className="avatar cmt-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {(author.nickname || '?').slice(0, 1)}
    </span>
  );
}

const CommentItem = memo(function CommentItem({ c, i }: { c: TrackComment; i: number }) {
  return (
    <article className="cmt reveal" style={{ '--i': i % 20 } as React.CSSProperties}>
      <Face author={c.author} size={34} />
      <div className="cmt-body">
        <div className="cmt-meta">
          <b>{c.author.nickname || '网易云用户'}</b>
          <span className="mono">{commentTime(c.time)}</span>
        </div>
        <p className="cmt-text">{c.content}</p>
        {c.replies.map((r, k) => (
          <blockquote key={r.id ?? k} className="cmt-quote">
            <b>@{r.author.nickname || '网易云用户'}</b>
            {r.content == null ? <span className="faint">这条评论已经删了</span> : <span>{r.content}</span>}
          </blockquote>
        ))}
      </div>
      {c.likedCount > 0 && (
        <span className="cmt-like mono" title={`${c.likedCount.toLocaleString('zh-CN')} 人赞过`}>
          <Icon name="heart" size={14} />
          {formatCount(c.likedCount).replace(' ', '')}
        </span>
      )}
    </article>
  );
});
