import type { AccountUser } from '../api';

/** 头像要用到的资料：账户用户和私信里的对方（不带邮箱）都能传 */
type AvatarUser = Pick<AccountUser, 'nickname' | 'avatarUrl' | 'avatarFallbackText' | 'avatarFallbackBg'> & { email?: string };

/** 头像：有图用图，没有就用账户服务给的兜底字和底色 */
export function Avatar({ user, size = 32 }: { user: AvatarUser; size?: number }) {
  if (user.avatarUrl) return <img className="avatar" src={user.avatarUrl} alt="" style={{ width: size, height: size }} />;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: user.avatarFallbackBg || undefined }}
      aria-hidden="true"
    >
      {user.avatarFallbackText || (user.nickname || user.email || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}
