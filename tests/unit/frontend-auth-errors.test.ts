import { afterEach, expect, it, vi } from 'vitest';
import { request, retryAfterSeconds } from '@/src/frontend/api/http';
afterEach(() => vi.restoreAllMocks());

it.each([
  [429, 5206, '密码连续输错', 900, '15 分钟'],
  [429, 5205, '尝试太频繁', 30, '30 秒'],
  [403, 5206, '没有操作权限', undefined, ''],
  [401, 5202, '邮箱或密码不对', undefined, ''],
  [503, 5403, '账户服务暂时连不上', undefined, ''],
])('explains auth HTTP %i / code %i without exposing server internals', async (status, code, message, retry, wait) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code, message: 'internal failure secret', retryable: true }, {
    status, headers: retry ? { 'retry-after': String(retry) } : {},
  }));
  await expect(request('/api/account/auth/login')).rejects.toMatchObject({ status, code, message: expect.stringContaining(message), retryAfterSeconds: retry });
  if (wait) await expect(request('/api/account/auth/login')).rejects.toMatchObject({ message: expect.stringContaining(wait) });
});

it('handles HTML gateway errors, network failures and HTTP-date Retry-After', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
    .mockRejectedValueOnce(new Error('internal connection failure'));
  await expect(request('/api/account/auth/login')).rejects.toMatchObject({ message: '账户服务暂时连不上，请稍后再试。' });
  await expect(request('/api/account/auth/login')).rejects.toMatchObject({ message: '连不上账户服务，检查一下网络后再试。' });
  vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
  expect(retryAfterSeconds(new Date(Date.now() + 60000).toUTCString())).toBe(60);
});
