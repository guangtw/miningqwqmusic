import type { AccountUser } from '../api';
import { api } from '../config/site';
import { authed, setUser } from './account';

// 个人资料：昵称、头像。账户服务返回改好后的用户，直接替换当前用户。

const p = api.paths;

export async function updateNickname(nickname: string) {
  const user = await authed<AccountUser>(p.profile, { method: 'PATCH', body: { nickname: nickname.trim() } });
  setUser(user);
  return user;
}

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_PX = 512;

/** 头像先在本地裁成居中的正方形、缩到 512px 再传；GIF 原样传，保留动图 */
async function squareAvatar(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(AVATAR_PX, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9));
  // 浏览器不会编码 WebP 时 toBlob 会给 PNG，账户服务两种都收
  return blob && AVATAR_TYPES.includes(blob.type) && blob.size <= api.avatarMaxBytes ? blob : file;
}

/** 选图后先检查格式和大小，不合规直接给中文提示，不浪费一次上传 */
export function avatarProblem(file: File): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return '只支持 PNG、JPG、WebP、GIF 图片。';
  if (file.size > api.avatarMaxBytes && file.type === 'image/gif') return 'GIF 动图要在 5MB 以内。';
  return null;
}

export async function uploadAvatar(file: File) {
  const blob = await squareAvatar(file);
  if (blob.size > api.avatarMaxBytes) throw new Error('图片太大了，换一张 5MB 以内的。');
  const ext = blob.type.split('/')[1] ?? 'png';
  const form = new FormData();
  form.append('avatar', blob, `avatar.${ext}`);
  const user = await authed<AccountUser>(p.profileAvatar, { method: 'POST', body: form });
  setUser(user);
  return user;
}

export async function removeAvatar() {
  const user = await authed<AccountUser>(p.profileAvatar, { method: 'DELETE' });
  setUser(user);
  return user;
}

// ---------------- 密码规则（和账户服务一致） ----------------

export const passwordRules = [
  { key: 'len', label: `${api.password.min} 位以上`, test: (s: string) => s.length >= api.password.min && s.length <= api.password.max },
  { key: 'lower', label: '小写字母', test: (s: string) => /[a-z]/.test(s) },
  { key: 'upper', label: '大写字母', test: (s: string) => /[A-Z]/.test(s) },
  { key: 'digit', label: '数字', test: (s: string) => /\d/.test(s) },
  { key: 'symbol', label: '符号', test: (s: string) => /[^A-Za-z0-9]/.test(s) },
] as const;

export function passwordProblem(pw: string): string | null {
  if (pw.length > api.password.max) return `密码最多 ${api.password.max} 位。`;
  const missing = passwordRules.filter((r) => !r.test(pw)).map((r) => r.label);
  return missing.length ? `密码还需要：${missing.join('、')}。` : null;
}
