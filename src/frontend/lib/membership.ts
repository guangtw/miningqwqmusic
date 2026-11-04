import type { MusicUnblockEntitlement, PlaybackAuthorization } from '@/src/types/account';
import type {
  MembershipAdminApplication,
  MembershipAdminMail,
  MembershipAdminState,
  MembershipAuditView,
  MembershipPolicyChanges,
  MembershipPolicyView,
  MembershipStatusResponse,
  OtpChallengeResponse,
} from '@/src/types/membership';
import { ApiError } from '../api/http';
import { api } from '../config/site';
import { authed, authStore } from './account';
import { createStore } from './store';

// 播放授权（会员卡）：兑换码开通后，可以放灰掉的歌、用更高的音质。
// 授权变了 player.ts 会自动按新权限重取播放地址。

const p = api.paths;

const toAuthorization = (e: MusicUnblockEntitlement): PlaybackAuthorization => ({
  enabled: e.enabled,
  version: e.version ?? authStore.get().playbackAuthorization?.version ?? 0,
  source: e.source ?? null,
  ...(e.redeemedAt ? { grantedAt: e.redeemedAt } : {}),
  ...(e.inviteLabel !== undefined ? { inviteLabel: e.inviteLabel } : {}),
  membershipKind: e.membershipKind,
  memberNumber: e.memberNumber,
  expiresAt: e.expiresAt,
  status: e.status,
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

// ---------------- 会员申请 ----------------
// 排队不占名额；轮到时服务端把兑换码发到账号邮箱，24 小时内兑换。
// 倒计时按服务端时间校准，权限一律以服务端为准，前端不自己判断谁能申请。

export const applyStore = createStore<{ userId: string | null; status: MembershipStatusResponse | null; offset: number }>({
  userId: null,
  status: null,
  offset: 0,
});

/** 服务端此刻的时间（用最近一次响应里的 serverTime 校准本机时钟） */
export const serverNow = () => Date.now() + applyStore.get().offset;

function keep(s: MembershipStatusResponse) {
  const userId = authStore.get().user?.id ?? null;
  applyStore.set({ userId, status: s, offset: Date.parse(s.serverTime) - Date.now() || 0 });
  return s;
}

/** 5902 在会员接口里是「名额满了」，和歌单排序的同号错误分开说 */
async function member<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ApiError && e.code === 5902) e.message = '会员名额已经满了，等有人到期后再来。';
    throw e;
  }
}

export const fetchApplication = () => member(() => authed<MembershipStatusResponse>(p.membershipApplication)).then(keep);
export const applyMembership = () => member(() => authed<MembershipStatusResponse>(p.membershipApplication, { method: 'POST' })).then(keep);
export const withdrawApplication = () => member(() => authed<MembershipStatusResponse>(p.membershipApplication, { method: 'DELETE' })).then(keep);

/** 重发同一张码（不延期、不加名额）。成功只代表进了发送队列，邮件状态看返回的 deliveryStatus */
export const resendOffer = () => member(() => authed<MembershipStatusResponse>(p.membershipResend, { method: 'POST' })).then(keep);

/** 确认账号邮箱：验证码发到数据库里的账号邮箱，前端不能指定收件人 */
export const requestMemberCode = () => member(() => authed<OtpChallengeResponse>(p.membershipEmailRequest, { method: 'POST' }));
export const verifyMemberCode = (challengeId: string, code: string) =>
  member(() => authed<MembershipStatusResponse>(p.membershipEmailVerify, { method: 'POST', body: { challengeId, code } })).then(keep);

// ---------------- 会员申请（管理员） ----------------

export const adminMembership = () => member(() => authed<MembershipAdminState>(p.adminMembership));
export const setMembershipPolicy = (changes: MembershipPolicyChanges) =>
  member(() => authed<MembershipPolicyView>(p.adminMembership, { method: 'PATCH', body: changes }));
export const adminApplications = (cursor?: string) => authed<MembershipAdminApplication[]>(p.adminMembershipApps, { query: { cursor } });
export const actOnApplication = (applicationId: string, action: 'cancel' | 'block' | 'unblock') =>
  member(() => authed(p.adminMembershipApps, { method: 'POST', body: { applicationId, action } }));
export const adminMail = (cursor?: string) => authed<MembershipAdminMail[]>(p.adminMembershipMail, { query: { cursor } });
export const retryMail = (mailId: string) => authed<{ queued: boolean }>(p.adminMembershipMail, { method: 'POST', body: { mailId } });
export const adminAudit = (cursor?: string) => authed<MembershipAuditView[]>(p.adminMembershipAudit, { query: { cursor } });
