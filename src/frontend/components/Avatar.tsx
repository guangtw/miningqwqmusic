import type { AccountUser } from '../api';
import { displayName } from '../lib/account';

/** 头像：有图用图，没有就用账户服务给的兜底字和底色 */
export function Avatar({ user, size = 32 }: { user: AccountUser; size?: number }) {
  if (user.avatarUrl) return <img className="avatar" src={user.avatarUrl} alt="" style={{ width: size, height: size }} />;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: user.avatarFallbackBg || undefined }}
      aria-hidden="true"
    >
      {user.avatarFallbackText || displayName(user).slice(0, 1).toUpperCase()}
    </span>
  );
}
