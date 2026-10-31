import type { MusicUnblockEntitlement, PlaybackAuthorization } from '@/src/types/account';
import { api } from '../config/site';
import { authed, authStore } from './account';

// 播放授权（会员卡）：兑换码开通后，可以放灰掉的歌、用更高的音质。
// 授权变了 player.ts 会自动按新权限重取播放地址。

const p = api.paths;

const toAuthorization = (e: MusicUnblockEntitlement): PlaybackAuthorization => ({
  enabled: e.enabled,
  version: e.version ?? authStore.get().playbackAuthorization?.version ?? 0,
  source: e.source ?? null,
  ...(e.redeemedAt ? { grantedAt: e.redeemedAt } : {}),
  ...(e.inviteLabel !== undefined ? { inviteLabel: e.inviteLabel } : {}),
});

function applyEntitlement(e: MusicUnblockEntitlement) {
  if (authStore.get().status !== 'authenticated') return;
  authStore.set({ playbackAuthorization: toAuthorization(e) });
}

/** 重新问一次授权状态（打开设置页时用，管理员可能刚给开通或撤销） */
export async function refreshEntitlement() {
  const userId = authStore.get().user?.id;
  const e = await authed<MusicUnblockEntitlement>(p.unblockEntitlement);
  if (authStore.get().user?.id === userId) applyEntitlement(e);
  return e;
}

export async function redeemCode(code: string) {
  const userId = authStore.get().user?.id;
  const e = await authed<MusicUnblockEntitlement>(p.unblockRedeem, { method: 'POST', body: { inviteCode: code.trim() } });
  if (authStore.get().user?.id === userId) applyEntitlement(e);
  return e;
}

// ---------------- 管理员 ----------------

export interface AuthorizedUser {
  id: string;
  email: string;
  nickname: string | null;
  role: 'user' | 'admin';
  playbackAuthorization: PlaybackAuthorization;
}

export const isAdmin = () => authStore.get().user?.role === 'admin';

export const listAuthorizedUsers = (q: string, signal?: AbortSignal) =>
  authed<AuthorizedUser[]>(p.adminAuthUsers, { query: { q: q.trim() || undefined }, signal });

async function adminSet(userId: string, enabled: boolean) {
  const snap = await authed<PlaybackAuthorization>(enabled ? p.adminAuthGrant : p.adminAuthRevoke, { method: 'POST', body: { userId } });
  // 给自己改的话，当前会话也跟着变
  if (authStore.get().user?.id === userId) authStore.set({ playbackAuthorization: snap });
  return snap;
}

export const grantAuthorization = (userId: string) => adminSet(userId, true);
export const revokeAuthorization = (userId: string) => adminSet(userId, false);
