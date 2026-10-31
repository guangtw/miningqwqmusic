import { useState } from 'react';
import { Icon } from './Icon';

/** 收藏按钮：点亮时弹一下，并散开一圈 */
export function HeartButton({ liked, onToggle, className = '' }: { liked: boolean; onToggle: () => void; className?: string }) {
  const [burst, setBurst] = useState(0);
  return (
    <button
      className={`icon-btn heart ${liked ? 'on' : ''} ${className}`}
      aria-label={liked ? '取消收藏' : '收藏'}
      aria-pressed={liked}
      onClick={(e) => {
        e.stopPropagation();
        if (!liked) setBurst((b) => b + 1);
        onToggle();
      }}
    >
      <span className="heart-icon" key={burst} data-pop={burst > 0 && liked ? '' : undefined}>
        <Icon name={liked ? 'heartFill' : 'heart'} />
      </span>
    </button>
  );
}
