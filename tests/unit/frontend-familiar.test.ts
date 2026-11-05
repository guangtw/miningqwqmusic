import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamiliarStatus } from '@/src/types/membership';
import type { SideAnswer } from '@/src/frontend/lib/familiar';

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok', traceId: 'unit' }));

const status = (extra: Partial<FamiliarStatus> = {}): FamiliarStatus => ({
  verified: false,
  verifiedAt: null,
  serverTime: new Date().toISOString(),
  canVerify: true,
  reason: null,
  nextChallengeAt: null,
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

describe('题面展示协议', () => {
  it('把 @ 行从题干里拆出来，用户只看到题干', async () => {
    const { parsePrompt } = await import('@/src/frontend/lib/familiar');
    const s = parsePrompt('提起甲和乙？\n@stage roster\n@kicker 点名册\n@fields 甲 | 乙\n@hint 写对一个就算。');
    expect(s).toEqual({ text: '提起甲和乙？', stage: 'roster', kicker: '点名册', fields: ['甲', '乙'], hint: '写对一个就算。' });
  });

  it('旧题没有 @ 行时原样显示，线索最多两个', async () => {
    const { parsePrompt } = await import('@/src/frontend/lib/familiar');
    expect(parsePrompt('一道普通的题')).toEqual({ text: '一道普通的题', fields: [] });
    expect(parsePrompt('题\n@fields 甲|乙|丙').fields).toEqual(['甲', '乙']);
    // @ 开头但不是认识的指令，算题干
    expect(parsePrompt('@谁 说的？').text).toBe('@谁 说的？');
  });

  it('写入再解析不丢东西', async () => {
    const { composePrompt, parsePrompt } = await import('@/src/frontend/lib/familiar');
    const s = { text: '题干', stage: 'signboard' as const, hint: '提示', kicker: '抬头', fields: ['甲', '乙'], suffix: '主任', was: '旧名' };
    expect(parsePrompt(composePrompt(s))).toEqual(s);
  });

  it('展示形式和题型对不上、两栋楼不是两个选项时退回默认', async () => {
    const { resolveStage } = await import('@/src/frontend/lib/familiar');
    expect(resolveStage('single_choice', 'chalk', 4)).toBe('chalk');
    expect(resolveStage('single_choice', 'plaque', 4)).toBe('tracklist');
    expect(resolveStage('text', 'chalk', 0)).toBe('notebook');
    expect(resolveStage('single_choice', 'dorms', 2)).toBe('dorms');
    expect(resolveStage('single_choice', 'dorms', 3)).toBe('tracklist');
    expect(resolveStage('single_choice', 'nonsense' as never, 3)).toBe('tracklist');
    expect(resolveStage('text', undefined, 0)).toBe('notebook');
  });
});

describe('提交', () => {
  it('按接口格式打包槽位：留空不提交，只剩一个就交字符串', async () => {
    const { slotPayload } = await import('@/src/frontend/lib/familiar');
    expect(slotPayload(null)).toBe('');
    expect(slotPayload({ kind: 'choice', id: 'opt' })).toBe('opt');
    expect(slotPayload({ kind: 'text', values: ['  甲 ', ''] })).toBe('甲');
    expect(slotPayload({ kind: 'text', values: ['', '乙'] })).toBe('乙');
    expect(slotPayload({ kind: 'text', values: ['甲', '乙'] })).toEqual(['甲', '乙']);
    expect(slotPayload({ kind: 'text', values: ['', '  '] })).toBe('');
  });

  it('any 答一面就能落针，all 两面都答才行', async () => {
    const { canSubmit } = await import('@/src/frontend/lib/familiar');
    const one: (SideAnswer | null)[] = [{ kind: 'choice', id: 'a' }, null];
    const both: (SideAnswer | null)[] = [{ kind: 'choice', id: 'a' }, { kind: 'text', values: ['甲'] }];
    expect(canSubmit('any', [null, null])).toBe(false);
    expect(canSubmit('any', one)).toBe(true);
    expect(canSubmit('all', one)).toBe(false);
    expect(canSubmit('all', [one[0], { kind: 'text', values: [' '] }])).toBe(false);
    expect(canSubmit('all', both)).toBe(true);
    // 旧挑战没有 passRule，按 any
    expect(canSubmit(undefined, one)).toBe(true);
  });

  it('只发挑战 id 和两个槽位，答案不进存储、不进地址，失败也只发一次', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: init?.body as string | undefined });
        return ok({ passed: false, serverTime: new Date().toISOString(), attemptsRemaining: 2, nextChallengeAt: new Date().toISOString() });
      }),
    );
    await signIn();
    const { submitAnswers } = await import('@/src/frontend/lib/familiar');
    const r = await submitAnswers('c-1', ['秘密答案', ['甲', '乙']]);
    expect(r.passed).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/account\/membership\/familiar\/verify$/);
    expect(JSON.parse(calls[0].body!)).toEqual({ challengeId: 'c-1', answers: ['秘密答案', ['甲', '乙']] });
    expect(calls[0].url).not.toContain('秘密');
    expect(JSON.stringify({ ...localStorage })).not.toContain('秘密');
  });

  it('网络失败时不自动重交（重交可能多扣一次机会）', async () => {
    const fetchMock = vi.fn(async (_url: string) => {
      throw new TypeError('network');
    });
    vi.stubGlobal('fetch', fetchMock);
    await signIn();
    const { submitAnswers } = await import('@/src/frontend/lib/familiar');
    await expect(submitAnswers('c-1', ['a', ''])).rejects.toThrow();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/verify'))).toHaveLength(1);
  });

  it('通过后更新资格、刷新申请状态', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.endsWith('/verify')) return ok({ passed: true, ...status({ verified: true, verifiedAt: '2026-11-05T12:00:00.000Z', reason: 'verified' }) });
        return ok({ serverTime: new Date().toISOString(), applicationsOpen: true, dispatchEnabled: true, emailLoginEnabled: true, emailVerifiedAt: null, canApply: true, reason: null, application: null });
      }),
    );
    await signIn();
    const f = await import('@/src/frontend/lib/familiar');
    await f.submitAnswers('c-1', ['a', '']);
    await vi.waitFor(() => expect(urls.some((u) => u.endsWith('/membership/application'))).toBe(true));
    expect(f.familiarStore.get().status?.verified).toBe(true);
  });
});

describe('挑战恢复', () => {
  it('没到期就走恢复（不带时期），到期后才让重新选', async () => {
    const f = await import('@/src/frontend/lib/familiar');
    f.familiarStore.set({ userId: 'me', status: null, offset: 0 });
    expect(f.hasLiveChallenge(status({ nextChallengeAt: new Date(Date.now() + 60_000).toISOString() }))).toBe(true);
    expect(f.hasLiveChallenge(status({ nextChallengeAt: new Date(Date.now() - 60_000).toISOString() }))).toBe(false);
    expect(f.hasLiveChallenge(status())).toBe(false);
    expect(f.hasLiveChallenge(null)).toBe(false);
  });

  it('到期判断按服务端时间：本机时钟慢也不会把过期的题当成还在', async () => {
    const f = await import('@/src/frontend/lib/familiar');
    f.familiarStore.set({ userId: 'me', status: null, offset: 10 * 60_000 });
    expect(f.hasLiveChallenge(status({ nextChallengeAt: new Date(Date.now() + 60_000).toISOString() }))).toBe(false);
  });

  it('恢复时发空对象，选时期时才带 periodId，「不确定」发 null', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return ok({ challengeId: 'c', serverTime: new Date().toISOString(), expiresAt: '', nextChallengeAt: '', available: true, attemptsRemaining: 3, questions: [] });
      }),
    );
    await signIn();
    const { openChallenge } = await import('@/src/frontend/lib/familiar');
    await openChallenge();
    await openChallenge('p-1');
    await openChallenge(null);
    expect(bodies).toEqual([{}, { periodId: 'p-1' }, { periodId: null }]);
  });
});

describe('题库导入', () => {
  it('先建停用的时期、再存题、最后用保存返回的 id 配必答并启用', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        calls.push({ url, body });
        return ok(url.endsWith('/periods') ? { id: body.id ?? `p${++n}` } : { questionId: `q${++n}` });
      }),
    );
    await signIn();
    const { importBank } = await import('@/src/frontend/lib/familiar');
    await importBank(
      {
        periods: [{ key: 'u', label: '大学', sortOrder: 1, passRule: 'all', required: ['a', 'b'] }],
        questions: [
          { key: 'a', period: 'u', title: 'A', group: 'g', prompt: 'A?', kind: 'single_choice', choices: ['x', 'y'], answers: ['x'] },
          { key: 'b', period: 'u', title: 'B', group: 'g', prompt: 'B?', kind: 'text', answers: ['z'] },
        ],
      },
      () => undefined,
    );
    expect(calls[0].body).toEqual({ label: '大学', sortOrder: 1, enabled: false });
    expect(calls[1].body).toMatchObject({ periodIds: ['p1'], status: 'active', kind: 'single_choice', choices: ['x', 'y'] });
    expect(calls[2].body).not.toHaveProperty('choices');
    expect(calls[3].body).toEqual({ id: 'p1', label: '大学', sortOrder: 1, enabled: true, passRule: 'all', requiredQuestionIds: ['q2', 'q3'] });
  });

  it('题库里的引用对不上就拒绝，一条都不写', async () => {
    const { parseBank } = await import('@/src/frontend/lib/familiar');
    expect(() => parseBank('{')).toThrow();
    expect(() => parseBank('{"periods":[]}')).toThrow();
    expect(() => parseBank(JSON.stringify({ periods: [], questions: [{ key: 'a', period: 'x' }] }))).toThrow(/不存在的时期/);
    expect(() => parseBank(JSON.stringify({ periods: [{ key: 'u', required: ['q'] }], questions: [] }))).toThrow(/必答题/);
  });
});

// 真实题库不进 Git（仓库是公开的），只在有这个文件的开发机上校验
const BANK = '.local/familiar-question-bank-final.json';

describe.runIf(existsSync(BANK))('定稿题库', () => {
  const raw = existsSync(BANK) ? readFileSync(BANK, 'utf8') : '{}';

  it('符合后端的限制，展示形式都认得，答案都在选项里', async () => {
    const { parseBank, parsePrompt, resolveStage } = await import('@/src/frontend/lib/familiar');
    const bank = parseBank(raw);
    for (const q of bank.questions) {
      expect(q.prompt.length).toBeLessThanOrEqual(500);
      const spec = parsePrompt(q.prompt);
      expect(spec.text.length).toBeGreaterThan(0);
      expect(spec.stage).toBeDefined();
      // 指定的形式真的生效，没有退回默认
      expect(resolveStage(q.kind, spec.stage, q.choices?.length ?? 0)).toBe(spec.stage);
      if (q.kind === 'single_choice') {
        expect(new Set(q.choices).size).toBe(q.choices!.length);
        expect(q.answers).toHaveLength(1);
        expect(q.choices).toContain(q.answers[0]);
      }
    }
  });

  it('全对的时期固定两题，必答题都属于这个时期', async () => {
    const { parseBank } = await import('@/src/frontend/lib/familiar');
    const bank = parseBank(raw);
    for (const p of bank.periods.filter((x) => x.passRule === 'all')) {
      expect(p.required).toHaveLength(2);
      expect(bank.questions.filter((q) => q.period === p.key).map((q) => q.key).sort()).toEqual([...p.required!].sort());
    }
  });

  it('用户能看到的内容里不写 neverShow 列出的词（能搜到人或学校的原名）', () => {
    const { neverShow = [], questions } = JSON.parse(raw) as { neverShow?: string[]; questions: { prompt: string; choices?: string[] }[] };
    for (const q of questions) {
      const visible = `${q.prompt}${(q.choices ?? []).join('')}`;
      for (const word of neverShow) expect(visible).not.toContain(word);
    }
  });

  it('前端源码不写任何答案（判分只在服务端）', () => {
    const { questions } = JSON.parse(raw) as { questions: { answers: string[] }[] };
    const src = ['src/frontend/lib/familiar.ts', 'src/frontend/components/FamiliarQuest.tsx', 'src/frontend/components/FamiliarStages.tsx', 'src/frontend/views/AdminFamiliar.tsx'].map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const q of questions) {
      for (const answer of q.answers) {
        // 单字太容易撞普通文案，只查两个字以上的
        if (answer.length > 1) expect(src).not.toContain(answer);
      }
    }
  });
});
