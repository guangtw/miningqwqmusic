import { useEffect, useState } from 'react';
import type { MessagePeer } from '@/src/types/social';
import { dismissNotice, messagesStore, noticeStore, type MessageNotice } from '../lib/messages';
import { usePresence } from '../lib/motion';
import { href, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { peerName } from '../views/Chat';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

const STAY = 6000;

/**
 * 新私信：从播放台上方滑出一张小卡片，点一下进聊天。几秒后自己收起，鼠标停在上面时先不收。
 * 同一个人接着发：卡片不重来，头像上的条数跳一下，正文换成最新一句
 */
export function DmNotice() {
  const notice = useStore(noticeStore, (s) => s.notice);
  const conversation = useStore(messagesStore, (s) => (notice ? s.conversations[notice.peerId] : undefined));
  const route = useRoute();
  const [hold, setHold] = useState(false);
  const [shown, setShown] = useState<MessageNotice | null>(notice);

  // 走进了这个人的聊天、或者在别的设备上读掉了：不用再提醒
  const here = route.parts[0] === 'friends' || (route.parts[0] === 'chat' && route.parts[1] === notice?.peerId);
  const read = conversation?.unreadCount === 0;
  const open = !!notice && !here && !read;
  const { mounted, state } = usePresence(open, 260);

  useEffect(() => {
    if (notice) setShown(notice);
  }, [notice]);
  useEffect(() => {
    if (notice && (here || read)) dismissNotice();
  }, [notice, here, read]);
  useEffect(() => {
    if (!notice || hold) return;
    const t = setTimeout(dismissNotice, STAY);
    return () => clearTimeout(t);
  }, [notice, hold]);

  if (!mounted || !shown) return null;
  const peer: MessagePeer = conversation?.peer ?? { id: shown.peerId, nickname: null, avatarUrl: null, avatarFallbackText: '·', avatarFallbackBg: '' };

  return (
    <div
      className="dm-notice"
      key={shown.peerId}
      data-state={state}
      role="status"
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <a className="dm-notice-link" href={href.chat(shown.peerId)} onClick={dismissNotice}>
        <span className="dm-notice-face">
          <Avatar user={peer} size={40} />
          {shown.count > 1 && (
            <span className="dm-notice-count mono" key={shown.count}>
              {shown.count > 99 ? '99+' : shown.count}
            </span>
          )}
        </span>
        <span className="dm-notice-text">
          <b>{conversation ? peerName(peer) : '新私信'}</b>
          <span className="dm-notice-line" key={shown.key}>
            {shown.text}
          </span>
        </span>
      </a>
      <button className="dm-notice-x" aria-label="先不看" onClick={dismissNotice}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
