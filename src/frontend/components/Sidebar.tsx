import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nav, site } from '../config/site';
import { authStore, displayName } from '../lib/account';
import { socialStore } from '../lib/friends';
import { messagesStore, unreadTotal } from '../lib/messages';
import { shortDate } from '../lib/format';
import { href, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { uiStore } from '../player/ui';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

const HINT_KEY = 'qwq-login-hint-shown';

/** 手机上没登录时，右上角的空头像旁边冒一次提示（每次打开网站最多一次，几秒后自己收起） */
function useLoginHint(show: boolean) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!show || !window.matchMedia('(max-width: 860px)').matches) return;
    try {
      if (sessionStorage.getItem(HINT_KEY)) return;
      sessionStorage.setItem(HINT_KEY, '1');
    } catch {
      // 隐私模式读不了也照样提示一次
    }
    const a = setTimeout(() => setOn(true), 1200);
    const b = setTimeout(() => setOn(false), 7200);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [show]);
  return [on, () => setOn(false)] as const;
}

const SECTION_ALIAS: Record<string, string> = { mine: 'library', friends: 'inbox', chat: 'inbox', help: 'settings' };

export function Sidebar() {
  const route = useRoute();
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  // 有人加你好友、邀请你一起听：头像上亮个小点。私信有自己的按钮和数字
  const waiting = useStore(socialStore, (s) => s.requests.incoming.length + s.invites.length);
  const unread = useStore(messagesStore, unreadTotal);
  const member = useStore(authStore, (s) => !!s.playbackAuthorization?.enabled);
  const [hint, hideHint] = useLoginHint(status === 'guest');
  // 自建歌单归在唱片架下
  const section = SECTION_ALIAS[route.parts[0] ?? ''] ?? route.parts[0] ?? '';
  const navRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  // 选中指示条滑到当前项（FLIP：直接改 transform，CSS 负责过渡）
  useLayoutEffect(() => {
    const box = navRef.current;
    const pill = pillRef.current;
    const el = box?.querySelector<HTMLElement>('a.on');
    if (!box || !pill) return;
    if (!el) {
      pill.style.opacity = '0';
      return;
    }
    const vertical = getComputedStyle(box).flexDirection === 'column';
    pill.style.opacity = '1';
    pill.style.width = `${el.offsetWidth}px`;
    pill.style.height = `${el.offsetHeight}px`;
    pill.style.transform = vertical ? `translateY(${el.offsetTop}px)` : `translateX(${el.offsetLeft}px)`;
  }, [section]);

  return (
    <nav className="side" aria-label="主导航">
      <a href={href.home()} className="brand" aria-label={site.name}>
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name" aria-hidden="true">
          <span className="brand-big">{site.brand.big}</span>
          <span className="brand-small">{site.brand.small}</span>
        </span>
      </a>
      <div className="brand-sub mono">{shortDate()}</div>

      <div className="nav" ref={navRef}>
        <span className="nav-pill" ref={pillRef} aria-hidden="true" />
        {nav.map((n) => (
          <a key={n.key} href={n.to} className={section === n.key ? 'on' : ''} aria-current={section === n.key ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
      </div>

      <div className="side-foot">
        {status === 'authenticated' && user && (
          <a
            href={href.friends()}
            className={`inbox ${section === 'inbox' ? 'on' : ''}`}
            aria-current={section === 'inbox' ? 'page' : undefined}
            aria-label={unread > 0 ? `私信，${unread} 条未读` : '私信'}
          >
            <Icon name="chat" />
            <span className="inbox-label">私信</span>
            {unread > 0 && (
              <span className="inbox-count mono" key={unread}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </a>
        )}
        {status === 'authenticated' && user ? (
          <a
            href={href.account()}
            className={`who ${section === 'account' || section === 'admin' ? 'on' : ''}`}
            aria-current={section === 'account' ? 'page' : undefined}
            title="个人中心"
          >
            <span className="who-avatar">
              <Avatar user={user} size={38} />
              {waiting > 0 && <span className="who-dot" aria-label={`${waiting} 条好友动态`} />}
            </span>
            <span className="who-text">
              <span className="who-name">{displayName(user)}</span>
              <span className="who-sub">{waiting > 0 ? `${waiting} 条好友动态` : member ? '会员 · 个人中心' : '个人中心'}</span>
            </span>
          </a>
        ) : status === 'guest' || status === 'unavailable' ? (
          // 宽屏直接弹登录；手机上去个人中心那一页（登录入口和设置都在那儿）
          <a
            href={href.account()}
            className={`who is-guest ${section === 'account' ? 'on' : ''}`}
            title="登录"
            onClick={(e) => {
              hideHint();
              if (status === 'guest' && !window.matchMedia('(max-width: 860px)').matches) {
                e.preventDefault();
                uiStore.set({ login: true });
              }
            }}
          >
            <span className="who-guest" aria-hidden="true">
              <Icon name="user" />
            </span>
            <span className="who-text">
              <span className="who-name">{status === 'guest' ? '登录 / 注册' : '账户服务未开启'}</span>
              <span className="who-sub">收藏和歌单跨设备同步</span>
            </span>
          </a>
        ) : null}
        {hint && (
          <button className="login-hint" onClick={() => (hideHint(), uiStore.set({ login: true }))}>
            还没登录，点这里登录后收藏和歌单会同步
          </button>
        )}
      </div>
    </nav>
  );
}
