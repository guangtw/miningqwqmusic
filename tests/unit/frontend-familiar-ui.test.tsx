import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamiliarChallengeView } from '@/src/types/membership';
import { QuestionStage, type Question } from '@/src/frontend/components/FamiliarStages';
import { parsePrompt, slotPayload, type SideAnswer } from '@/src/frontend/lib/familiar';

function Harness({ question, onChange }: { question: Question; onChange?: (a: SideAnswer) => void }) {
  const [answer, setAnswer] = useState<SideAnswer | null>(null);
  return (
    <QuestionStage
      question={question}
      spec={parsePrompt(question.prompt)}
      answer={answer}
      name="t"
      onAnswer={(a) => {
        setAnswer(a);
        onChange?.(a);
      }}
    />
  );
}

const options = (...labels: string[]) => labels.map((label, i) => ({ id: `id-${i}`, label }));

afterEach(cleanup);

describe('题面道具', () => {
  it.each(['chalk', 'signboard', 'idcard', 'tracklist'])('%s：选项是真的单选框，按服务端顺序摆，交的是选项 id', (stage) => {
    const seen: SideAnswer[] = [];
    render(<Harness question={{ slot: 0, kind: 'single_choice', prompt: `题干\n@stage ${stage}`, options: options('丙', '甲', '乙') }} onChange={(a) => seen.push(a)} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['丙', '甲', '乙']);
    fireEvent.click(radios[1]);
    expect(seen.at(-1)).toEqual({ kind: 'choice', id: 'id-1' });
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('heading').textContent).toBe('题干');
  });

  it('两栋楼：选中才开店，另一栋不受影响', () => {
    const { container } = render(<Harness question={{ slot: 0, kind: 'single_choice', prompt: '题\n@stage dorms\n@kicker 小卖部', options: options('东楼', '西楼') }} />);
    expect(container.querySelector('.dorm-shop')).toBeNull();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    const dorms = container.querySelectorAll('.dorm');
    expect(dorms[0].querySelector('.dorm-shop')).toBeNull();
    expect(dorms[1].querySelector('.dorm-shop')?.textContent).toContain('小卖部');
  });

  it('两栋楼的窗户左右对称，外观不暗示答案', () => {
    const { container } = render(<Harness question={{ slot: 0, kind: 'single_choice', prompt: '题\n@stage dorms', options: options('东楼', '西楼') }} />);
    const [a, b] = [...container.querySelectorAll('.dorm-face')].map((f) => [...f.children].map((w) => w.classList.contains('lit')));
    const mirrored = b.map((_, i) => b[i - (i % 4) + 3 - (i % 4)]);
    expect(mirrored).toEqual(a);
  });

  it('翻牌招牌：没选时是问号，选了显示选项，旧名字划掉', () => {
    const { container } = render(<Harness question={{ slot: 0, kind: 'single_choice', prompt: '题\n@stage signboard\n@was 老名字', options: options('新一', '新二') }} />);
    const flaps = () => [...container.querySelectorAll('.flap')].map((x) => x.textContent);
    expect(flaps()).toEqual(['?', '?']);
    expect(container.querySelector('.sign-was s')?.textContent).toBe('老名字');
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(flaps()).toEqual(['新', '二']);
  });

  it('田字格：每个线索一格，只写一个也能交', () => {
    const seen: SideAnswer[] = [];
    render(<Harness question={{ slot: 0, kind: 'text', prompt: '题\n@stage roster\n@fields 甲|乙' }} onChange={(a) => seen.push(a)} />);
    fireEvent.change(screen.getByLabelText('乙姓什么'), { target: { value: '王' } });
    expect(seen.at(-1)).toEqual({ kind: 'text', values: ['', '王'] });
    expect(slotPayload(seen.at(-1))).toBe('王');
    fireEvent.change(screen.getByLabelText('甲姓什么'), { target: { value: '李' } });
    expect(slotPayload(seen.at(-1))).toEqual(['李', '王']);
  });

  it('门牌：一个输入框加后缀，线索不会变成多个槽位', () => {
    const seen: SideAnswer[] = [];
    render(<Harness question={{ slot: 0, kind: 'text', prompt: '门牌上写的是谁？\n@stage plaque\n@suffix 老师\n@kicker 办公室' }} onChange={(a) => seen.push(a)} />);
    expect(screen.getByText('老师')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '王' } });
    expect(seen.at(-1)).toEqual({ kind: 'text', values: ['王'] });
  });

  it('群聊：标题栏是唯一的输入框，聊天内容读屏跳过', () => {
    const seen: SideAnswer[] = [];
    const { container } = render(<Harness question={{ slot: 0, kind: 'text', prompt: '这个群叫什么？\n@stage groupchat' }} onChange={(a) => seen.push(a)} />);
    fireEvent.change(screen.getByRole('textbox', { name: '这个群叫什么？' }), { target: { value: '某个群' } });
    expect(seen.at(-1)).toEqual({ kind: 'text', values: ['某个群'] });
    expect(container.querySelector('.chat-log')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('旧题没有 kind 和展示设置也能答', () => {
    render(<Harness question={{ slot: 0, prompt: '一道老题' }} />);
    expect(screen.getByRole('heading').textContent).toBe('一道老题');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

// ---------------- 申请页 ----------------

describe('申请页的天数提示', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const show = async (extra: Record<string, unknown>) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/membership/familiar')) return new Response(JSON.stringify({ code: 404, message: 'x' }), { status: 404 });
        return new Response(JSON.stringify({ code: 0, message: 'ok', traceId: 't', data: { serverTime: new Date().toISOString(), applicationsOpen: true, dispatchEnabled: true, emailLoginEnabled: true, emailVerifiedAt: '2026-11-05T00:00:00.000Z', canApply: true, reason: null, application: null, ...extra } }));
      }),
    );
    const { authStore } = await import('@/src/frontend/lib/account');
    authStore.set({ status: 'authenticated', token: 'tok', user: { id: 'me', email: 'me@example.test' } as never });
    const { MemberApply } = await import('@/src/frontend/components/MemberApply');
    render(<MemberApply />);
  };

  it('能申请和已经是会员时都看得到', async () => {
    await show({});
    expect(await screen.findByText(/有我微信的朋友大胆来私信/)).toBeTruthy();
    cleanup();
    await show({ reason: 'already_member', canApply: false });
    expect(await screen.findByText(/有我微信的朋友大胆来私信/)).toBeTruthy();
  });

  it('申请受限、没开放或邮箱没确认时不出现', async () => {
    await show({ reason: 'application_blocked', canApply: false });
    await screen.findByText(/申请受到限制/);
    expect(screen.queryByText(/有我微信的朋友大胆来私信/)).toBeNull();
    cleanup();
    await show({ applicationsOpen: false, canApply: false });
    await screen.findByText(/暂时没有开放/);
    expect(screen.queryByText(/有我微信的朋友大胆来私信/)).toBeNull();
    cleanup();
    await show({ emailVerifiedAt: null, reason: 'email_verification_required', canApply: false });
    await screen.findByRole('button', { name: /发送验证码/ });
    expect(screen.queryByText(/有我微信的朋友大胆来私信/)).toBeNull();
  });
});

// ---------------- 整段流程 ----------------

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok', traceId: 'unit' }));
const fail = (status: number, code: number) => new Response(JSON.stringify({ code, message: 'x', traceId: 'unit', retryable: false }), { status });
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const baseStatus = { verified: false, verifiedAt: null, serverTime: iso(), canVerify: true, reason: null, nextChallengeAt: null };
const challenge = (extra: Partial<FamiliarChallengeView> = {}): FamiliarChallengeView => ({
  challengeId: 'c-1',
  serverTime: iso(),
  expiresAt: iso(86_400_000),
  nextChallengeAt: iso(86_400_000),
  available: true,
  attemptsRemaining: 3,
  passRule: 'any',
  period: { id: 'p', label: '某时期' },
  questions: [
    { slot: 0, prompt: '第一题\n@stage tracklist', kind: 'single_choice', options: options('左', '右') },
    { slot: 1, prompt: '第二题\n@stage notebook', kind: 'text' },
  ],
  ...extra,
});

type Handler = (path: string, body: unknown) => Response | undefined;

async function mount(handler: Handler) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/account/, '');
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, body });
      return handler(path, body) ?? ok({});
    }),
  );
  const { authStore } = await import('@/src/frontend/lib/account');
  authStore.set({ status: 'authenticated', token: 'tok', user: { id: 'me', email: 'me@example.test' } as never });
  // 关掉动画等待，时间线一步走完
  localStorage.setItem('settings', '{}');
  const settings = await import('@/src/frontend/lib/settings');
  vi.spyOn(settings, 'motionEnabled').mockReturnValue(false);
  const { FamiliarEntry } = await import('@/src/frontend/components/FamiliarQuest');
  render(<FamiliarEntry />);
  return calls;
}

describe('对暗号流程', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('验证没开放时入口不出现，也不打扰正常申请', async () => {
    const calls = await mount((p) => (p === '/membership/familiar' ? ok({ ...baseStatus, canVerify: false, reason: 'unavailable' }) : undefined));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('.fq-entry')).toBeNull();
    expect(calls.some((c) => c.path.includes('/challenge'))).toBe(false);
  });

  it('旧后端没有这个接口时入口不出现', async () => {
    await mount((p) => (p === '/membership/familiar' ? fail(404, 5000) : undefined));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.fq-entry')).toBeNull();
  });

  it('打开入口不会自动抽题；选了时期才申请，答错保留答案，再答对开门', async () => {
    let attempts = 3;
    const calls = await mount((p, body) => {
      if (p === '/membership/familiar') return ok({ ...baseStatus, periodOptions: [{ id: 'p', label: '某时期' }], canUseRandom: true });
      if (p === '/membership/familiar/challenge') return ok(challenge({ attemptsRemaining: attempts }));
      if (p === '/membership/familiar/verify') {
        const answers = (body as { answers: unknown[] }).answers;
        if (answers[1] === '对') return ok({ ...baseStatus, passed: true, verified: true, verifiedAt: iso(), reason: 'verified' });
        attempts -= 1;
        return ok({ passed: false, serverTime: iso(), attemptsRemaining: attempts, nextChallengeAt: iso(86_400_000) });
      }
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: '敲门' }));
    await waitFor(() => expect(document.querySelector('.sleeve')).not.toBeNull());
    expect(calls.some((c) => c.path.endsWith('/challenge'))).toBe(false);
    expect(document.querySelectorAll('.sleeve')).toHaveLength(2);

    fireEvent.click(document.querySelector('.sleeve')!);
    await screen.findByRole('radio', { name: '左' });
    expect(calls.find((c) => c.path.endsWith('/challenge'))?.body).toEqual({ periodId: 'p' });

    fireEvent.click(screen.getByRole('radio', { name: '左' }));
    fireEvent.click(screen.getByRole('button', { name: '留白，直接落针' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/verify'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/verify'))?.body).toEqual({ challengeId: 'c-1', answers: ['id-0', ''] });

    // 回到答题，选择还在，只说放不出声
    const kept = await screen.findByRole('radio', { name: '左' });
    expect((kept as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('.fq-chances')?.getAttribute('aria-label')).toContain('2');
    expect(document.body.textContent).toContain('放不出声');
    expect(document.body.textContent).not.toMatch(/陌生人|错在|第一题错/);

    fireEvent.click(screen.getByRole('button', { name: '翻到 B 面' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: '对' } });
    fireEvent.click(screen.getByRole('button', { name: '落针' }));
    await screen.findByText('是你啊。进来坐。');
    expect(document.querySelector('.regular-title')?.textContent).toBe('熟客');
    expect(document.body.textContent).toContain('某时期');
  });

  it('还有没到期的题时直接恢复，不让重选时期', async () => {
    const calls = await mount((p) => {
      if (p === '/membership/familiar') return ok({ ...baseStatus, nextChallengeAt: iso(3_600_000), periodOptions: [{ id: 'p', label: '某时期' }], canUseRandom: true });
      if (p === '/membership/familiar/challenge') return ok(challenge({ attemptsRemaining: 2 }));
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: '接着答' }));
    await screen.findByRole('radio', { name: '左' });
    expect(document.querySelector('.sleeve')).toBeNull();
    expect(calls.find((c) => c.path.endsWith('/challenge'))?.body).toEqual({});
    expect(document.querySelector('.fq-chances')?.getAttribute('aria-label')).toContain('2');
  });

  it('全对规则下一面没答就落不了针', async () => {
    await mount((p) => {
      if (p === '/membership/familiar') return ok({ ...baseStatus, nextChallengeAt: iso(3_600_000) });
      if (p === '/membership/familiar/challenge') return ok(challenge({ passRule: 'all', requiredCorrectCount: 2 }));
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: '接着答' }));
    fireEvent.click(await screen.findByRole('radio', { name: '左' }));
    // 只能翻面，没有「留白落针」
    expect(screen.queryByRole('button', { name: '留白，直接落针' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '翻到 B 面' }));
    await screen.findByRole('textbox');
    expect((screen.getByRole('button', { name: '落针' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('三次用完（或被收回）显示打烊，普通申请还在，到期前不能重新抽', async () => {
    const calls = await mount((p) => {
      if (p === '/membership/familiar') return ok({ ...baseStatus, nextChallengeAt: iso(3_600_000) });
      if (p === '/membership/familiar/challenge') return ok(challenge({ available: false, attemptsRemaining: 0, questions: [] }));
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: '接着答' }));
    await screen.findByText('今日打烊');
    expect(screen.getByRole('button', { name: '去普通申请' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '再敲一次门' })).toBeNull();
    expect(calls.filter((c) => c.path.endsWith('/challenge'))).toHaveLength(1);
  });

  it('提交没拿到结果时先查资格，已通过就开门，绝不重交', async () => {
    let verified = false;
    const calls = await mount((p) => {
      if (p === '/membership/familiar') return ok(verified ? { ...baseStatus, verified: true, verifiedAt: iso(), reason: 'verified' } : { ...baseStatus, nextChallengeAt: iso(3_600_000) });
      if (p === '/membership/familiar/challenge') return ok(challenge());
      if (p === '/membership/familiar/verify') {
        verified = true;
        return fail(503, 5924);
      }
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: '接着答' }));
    fireEvent.click(await screen.findByRole('radio', { name: '左' }));
    fireEvent.click(screen.getByRole('button', { name: '留白，直接落针' }));
    await screen.findByText('是你啊。进来坐。');
    expect(calls.filter((c) => c.path.endsWith('/verify'))).toHaveLength(1);
  });

  it('已有资格时入口是熟客标记，能再看卡，不会申请挑战', async () => {
    const calls = await mount((p) => (p === '/membership/familiar' ? ok({ ...baseStatus, verified: true, verifiedAt: '2026-11-05T12:00:00.000Z', reason: 'verified' }) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: '看看熟客卡' }));
    await screen.findByText('你的熟客卡');
    expect(calls.some((c) => c.path.endsWith('/challenge'))).toBe(false);
  });

  it('没确认邮箱时不能敲门', async () => {
    await mount((p) => (p === '/membership/familiar' ? ok({ ...baseStatus, canVerify: false, reason: 'email_verification_required' }) : undefined));
    expect((await screen.findByRole('button', { name: '敲门' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain('确认邮箱');
  });
});
