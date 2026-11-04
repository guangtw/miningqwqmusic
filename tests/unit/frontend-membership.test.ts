import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MembershipStatusResponse } from '@/src/types/membership';

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok', traceId: 'unit' }));
const fail = (status: number, code: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ code, message: 'x', traceId: 'unit', retryable: false, ...extra }), { status });

const status = (extra: Partial<MembershipStatusResponse> = {}): MembershipStatusResponse => ({
  serverTime: new Date(Date.now() + 90_000).toISOString(),
  applicationsOpen: true,
  dispatchEnabled: true,
  emailLoginEnabled: true,
  emailVerifiedAt: '2026-11-04T11:58:00.000Z',
  canApply: true,
  reason: null,
  application: null,
  ...extra,
});

async function signIn() {
  const { authStore } = await import('@/src/frontend/lib/account');
  authStore.set({ status: 'authenticated', token: 'tok', user: { id: 'me', email: 'me@example.test' } as never });
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('membership application', () => {
  it('keeps the latest status per user and calibrates the clock from serverTime', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(status())));
    await signIn();
    const m = await import('@/src/frontend/lib/membership');
    await m.fetchApplication();
    expect(m.applyStore.get().userId).toBe('me');
    // 服务端快了 90 秒：倒计时按服务端算
    expect(m.serverNow() - Date.now()).toBeGreaterThan(85_000);
  });

  it('submits, withdraws and resends without request bodies, and never sends a user id or address', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
        return ok(status());
      }),
    );
    await signIn();
    const m = await import('@/src/frontend/lib/membership');
    await m.applyMembership();
    await m.withdrawApplication();
    await m.resendOffer();
    await m.requestMemberCode();
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api\/account/, '')}`)).toEqual([
      'POST /membership/application',
      'DELETE /membership/application',
      'POST /membership/application/resend',
      'POST /membership/email/request',
    ]);
    expect(calls.every((c) => c.body === undefined)).toBe(true);
  });

  it('explains a full house instead of the playlist meaning of 5902', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(409, 5902)));
    await signIn();
    const m = await import('@/src/frontend/lib/membership');
    await expect(m.applyMembership()).rejects.toThrow('会员名额已经满了');
    await expect(m.grantAuthorization('another-user')).rejects.toThrow('会员名额已经满了');
    await expect(m.redeemCode('unused-code')).rejects.toThrow('会员名额已经满了');
  });
  it('does not attribute a late response to a different signed-in account', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => {finish = resolve;})));
    await signIn();
    const m = await import('@/src/frontend/lib/membership');
    const a = await import('@/src/frontend/lib/account');
    const pending = m.fetchApplication();
    a.authStore.set({user: {id: 'another', email: 'another@example.test'} as never});
    finish(ok(status()));
    await pending;
    expect(m.applyStore.get().status).toBeNull();
    expect(m.applyStore.get().userId).toBeNull();
  });
});

describe('email-assisted login', () => {
  it('signs in with the latest challenge exactly like a password login, keeping leading zeros', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/auth/email/verify')) {
          bodies.push(JSON.parse(String(init.body)));
          return ok({ accessToken: 'new', user: { id: 'u1', email: 'a@example.test' }, playbackAuthorization: { enabled: false, version: 1, source: null } });
        }
        return ok({});
      }),
    );
    const a = await import('@/src/frontend/lib/account');
    await a.loginWithCode('challenge-2', '012345');
    expect(bodies).toEqual([{ challengeId: 'challenge-2', code: '012345' }]);
    expect(a.authStore.get()).toMatchObject({ status: 'authenticated', token: 'new', user: { id: 'u1' } });
  });

  it('leaves the current session alone when the code is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(400, 5905)));
    await signIn();
    const a = await import('@/src/frontend/lib/account');
    await expect(a.loginWithCode('c', '000000')).rejects.toThrow('验证码不对');
    expect(a.authStore.get()).toMatchObject({ status: 'authenticated', token: 'tok' });
  });
});
