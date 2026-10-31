import { useLayoutEffect, useRef } from 'react';
import { nav, site } from '../config/site';
import { authStore, displayName } from '../lib/account';
import { shortDate } from '../lib/format';
import { href, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { uiStore } from '../player/ui';
import { Avatar } from './Avatar';

export function Sidebar() {
  const route = useRoute();
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  const section = route.parts[0] ?? '';
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
        {status === 'authenticated' && user ? (
          <a href={href.library()} className="who">
            <Avatar user={user} size={30} />
            <span className="who-name">{displayName(user)}</span>
          </a>
        ) : status === 'guest' ? (
          <button className="btn sm" onClick={() => uiStore.set({ login: true })}>
            登录同步
          </button>
        ) : null}
      </div>
    </nav>
  );
}
