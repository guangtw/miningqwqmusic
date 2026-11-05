import type {
  FamiliarAdminAccount,
  FamiliarAdminAction,
  FamiliarAdminDetail,
  FamiliarAdminPeriod,
  FamiliarChallengeView,
  FamiliarPeriodInput,
  FamiliarPeriodView,
  FamiliarQuestionInput,
  FamiliarQuestionView,
  FamiliarSlotAnswer,
  FamiliarStatus,
  FamiliarVerifyResult,
  MembershipAdminApplication,
  MembershipAdmissionAdminState,
  MembershipAdmissionPolicyChanges,
  MembershipPolicyView,
} from '@/src/types/membership';
import { api } from '../config/site';
import { authed, authStore } from './account';
import { fetchApplication } from './membership';
import { createStore } from './store';

// 熟人暗号：判分、抽题、次数全在服务端，这里只把题目摆出来、把选择原样交回去。
// 提交的内容不进日志、不进本地存储，验证 POST 也不自动重试（失败要扣次数）。

const p = api.paths;

export const familiarStore = createStore<{ userId: string | null; status: FamiliarStatus | null; offset: number }>({
  userId: null,
  status: null,
  offset: 0,
});

/** 服务端此刻的时间，倒计时都按它算 */
export const familiarNow = () => Date.now() + familiarStore.get().offset;

function keep(s: FamiliarStatus) {
  const userId = authStore.get().user?.id ?? null;
  familiarStore.set({ userId, status: s, offset: Date.parse(s.serverTime) - Date.now() || 0 });
  return s;
}

export const fetchFamiliar = () => authed<FamiliarStatus>(p.familiar).then(keep);

/** 同一账号一组题固定 24 小时：还没到期时重复请求拿回原题，改选时期也不会换题 */
export const openChallenge = (periodId?: string | null) =>
  authed<FamiliarChallengeView>(p.familiarChallenge, { method: 'POST', body: periodId === undefined ? {} : { periodId } }).then((c) => {
    familiarStore.set({ ...familiarStore.get(), offset: Date.parse(c.serverTime) - Date.now() || 0 });
    return c;
  });

export async function submitAnswers(challengeId: string, answers: [FamiliarSlotAnswer, FamiliarSlotAnswer]) {
  const r = await authed<FamiliarVerifyResult>(p.familiarVerify, { method: 'POST', body: { challengeId, answers } });
  if (r.passed) {
    keep(r);
    // 资格变了，申请的排位可能也变了
    void fetchApplication().catch(() => undefined);
  }
  return r;
}

/** 这组题还没到期（固定 24 小时），此时再请求只会恢复原题 */
export const hasLiveChallenge = (s: FamiliarStatus | null) => !!s?.nextChallengeAt && Date.parse(s.nextChallengeAt) > familiarNow();

// ---------------- 答案 ----------------

/** 一面的答案：单选是选项 id，填空是一到两个输入框的内容 */
export type SideAnswer = { kind: 'choice'; id: string } | { kind: 'text'; values: string[] };

export const answerIsEmpty = (a: SideAnswer | null | undefined) =>
  !a || (a.kind === 'choice' ? !a.id : !a.values.some((v) => v.trim()));

/** 按接口格式打包一个槽位：留空的输入框不提交，只剩一个就交字符串 */
export function slotPayload(a: SideAnswer | null | undefined): FamiliarSlotAnswer {
  if (!a) return '';
  if (a.kind === 'choice') return a.id;
  const filled = a.values.map((v) => v.trim()).filter(Boolean);
  return filled.length > 1 ? filled.slice(0, 2) : (filled[0] ?? '');
}

/** any 至少答一面，all 两面都要答（留空必错，不让白白浪费一次机会） */
export function canSubmit(rule: FamiliarChallengeView['passRule'], answers: (SideAnswer | null)[]) {
  const done = answers.filter((a) => !answerIsEmpty(a)).length;
  return rule === 'all' ? done === 2 : done >= 1;
}

// ---------------- 题面的展示形式 ----------------
// 题目只有服务端下发的一段 prompt。展示形式写在 prompt 末尾的 @ 行里，和题干一起存，
// 所以换题、加题不用发前端，前端也不必知道任何具体题目。认不出的形式退回默认样式。

export type StageName = 'chalk' | 'signboard' | 'dorms' | 'idcard' | 'tracklist' | 'notebook' | 'roster' | 'plaque';
const CHOICE_STAGES: StageName[] = ['chalk', 'signboard', 'dorms', 'idcard', 'tracklist'];
const TEXT_STAGES: StageName[] = ['notebook', 'roster', 'plaque'];

export const STAGE_LABEL: Record<StageName, string> = {
  tracklist: '曲目单（单选默认）',
  chalk: '黑板圈字（单选）',
  signboard: '翻牌招牌（单选）',
  dorms: '两栋楼（只限两个选项）',
  idcard: '学生证盖章（单选）',
  notebook: '横线本（填空默认）',
  roster: '田字格点名册（填空）',
  plaque: '门牌（填空）',
};
export const stagesFor = (kind: 'text' | 'single_choice') => (kind === 'text' ? TEXT_STAGES : CHOICE_STAGES);

export interface StagePrompt {
  /** 给用户看的题干 */
  text: string;
  stage?: StageName;
  hint?: string;
  /** 道具上的小标题：黑板抬头、门牌上的办公室名 */
  kicker?: string;
  /** 填空的线索，每个线索一个输入框，最多两个 */
  fields: string[];
  /** 紧跟输入框的后缀，比如「主任」 */
  suffix?: string;
  /** 旧名字：招牌上被划掉的那一行 */
  was?: string;
}

const DIRECTIVE = /^@(stage|hint|kicker|fields|suffix|was)[ \t]+(.+)$/;

export function parsePrompt(prompt: string): StagePrompt {
  const out: StagePrompt = { text: '', fields: [] };
  const body: string[] = [];
  for (const line of prompt.split(/\r?\n/)) {
    const m = DIRECTIVE.exec(line.trim());
    if (!m) {
      body.push(line);
      continue;
    }
    const value = m[2].trim();
    if (m[1] === 'stage') out.stage = value as StageName;
    else if (m[1] === 'fields') out.fields = value.split('|').map((v) => v.trim()).filter(Boolean).slice(0, 2);
    else out[m[1] as 'hint' | 'kicker' | 'suffix' | 'was'] = value;
  }
  out.text = body.join('\n').trim();
  return out;
}

export function composePrompt(s: StagePrompt) {
  const lines = [s.text.trim()];
  if (s.stage) lines.push(`@stage ${s.stage}`);
  if (s.kicker?.trim()) lines.push(`@kicker ${s.kicker.trim()}`);
  if (s.hint?.trim()) lines.push(`@hint ${s.hint.trim()}`);
  if (s.fields.length) lines.push(`@fields ${s.fields.join('|')}`);
  if (s.suffix?.trim()) lines.push(`@suffix ${s.suffix.trim()}`);
  if (s.was?.trim()) lines.push(`@was ${s.was.trim()}`);
  return lines.join('\n');
}

/** 这道题实际用哪种展示：和题型对不上、或选项数不够的，退回默认 */
export function resolveStage(kind: 'text' | 'single_choice', stage: StageName | undefined, optionCount: number): StageName {
  const fallback: StageName = kind === 'text' ? 'notebook' : 'tracklist';
  if (!stage || !stagesFor(kind).includes(stage)) return fallback;
  if (stage === 'dorms' && optionCount !== 2) return fallback;
  return stage;
}

// ---------------- 盲猜通过率 ----------------
// 三次机会里单选可以靠排除法试，这里算完全不认识的人最多能靠猜过的概率。填空按猜不中算。

const ATTEMPTS = 3;
type Guessable = Pick<FamiliarQuestionView, 'kind' | 'choices'>;
const guessChance = (q: Guessable) => (q.kind === 'text' ? 0 : Math.min(1, ATTEMPTS / Math.max(1, q.choices.length)));

/** any 两面各试各的；all 要同一次两面都中，三次只能试三种组合 */
export function pairGuessRate(rule: 'any' | 'all', a: Guessable, b: Guessable) {
  if (rule === 'any') return 1 - (1 - guessChance(a)) * (1 - guessChance(b));
  if (a.kind === 'text' || b.kind === 'text') return 0;
  return Math.min(1, ATTEMPTS / (a.choices.length * b.choices.length));
}

/** 随机抽两题时，所有可能的组合取平均。题不够两道返回 null */
export function poolGuessRate(rule: 'any' | 'all', pool: Guessable[]) {
  const rates: number[] = [];
  pool.forEach((a, i) => pool.slice(i + 1).forEach((b) => rates.push(pairGuessRate(rule, a, b))));
  return rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : null;
}

/** 这个时期的盲猜通过率：固定两题就算这两题，否则按抽题规则（优先定向，只有一道时才补通用题） */
export function periodGuessRate(period: Pick<FamiliarPeriodView, 'id' | 'passRule' | 'requiredQuestionIds'>, active: FamiliarQuestionView[], strictIds: Set<string>) {
  if (period.requiredQuestionIds.length === 2) {
    const [a, b] = period.requiredQuestionIds.map((id) => active.find((q) => q.questionId === id));
    return a && b ? pairGuessRate(period.passRule, a, b) : null;
  }
  const open = active.filter((q) => !strictIds.has(q.questionId));
  const targeted = open.filter((q) => q.periodIds?.includes(period.id));
  if (targeted.length >= 2) return poolGuessRate(period.passRule, targeted);
  const general = open.filter((q) => !q.periodIds?.length);
  if (targeted.length !== 1 || !general.length) return null;
  const rates = general.map((g) => pairGuessRate(period.passRule, targeted[0], g));
  return rates.reduce((x, y) => x + y, 0) / rates.length;
}

/** 超过这个比例，后台标红提醒 */
export const GUESS_WARN = 0.25;

// ---------------- 管理员 ----------------

export const adminAdmission = () => authed<MembershipAdmissionAdminState>(p.adminMembership);
export const setAdmissionPolicy = (changes: MembershipAdmissionPolicyChanges) =>
  authed<MembershipPolicyView>(p.adminMembership, { method: 'PATCH', body: changes });

export const adminPeriods = () => authed<FamiliarAdminPeriod[]>(p.adminFamiliarPeriods);
export const savePeriod = (input: FamiliarPeriodInput) => authed<FamiliarAdminPeriod>(p.adminFamiliarPeriods, { method: 'POST', body: input });

export const adminQuestions = (cursor?: string) => authed<FamiliarQuestionView[]>(p.adminFamiliarQuestions, { query: { cursor } });
export const saveQuestion = (input: FamiliarQuestionInput) => authed<FamiliarQuestionView>(p.adminFamiliarQuestions, { method: 'POST', body: input });
export const disableQuestion = (versionId: string, allVersions = false) =>
  authed<{ disabled: boolean }>(p.adminFamiliarQuestions, { method: 'DELETE', body: { versionId, allVersions } });

/** 把所有版本翻完：每页最多 50 条，cursor 是最后一条的 id */
export async function allQuestionVersions() {
  const rows: FamiliarQuestionView[] = [];
  for (;;) {
    const page = await adminQuestions(rows.at(-1)?.id);
    rows.push(...page);
    if (page.length < 50) return rows;
  }
}

export const adminRecognitions = (q: { cursor?: string; versionId?: string } = {}) => authed<FamiliarAdminAccount[]>(p.adminFamiliarRecognitions, { query: q });
export const adminRecognitionDetail = (userId: string) => authed<FamiliarAdminDetail>(p.adminFamiliarRecognitions, { query: { userId } });
export const actOnRecognition = (action: FamiliarAdminAction) => authed<FamiliarAdminDetail>(p.adminFamiliarRecognitions, { method: 'POST', body: action });

export const adminLaneApplications = (lane: 'familiar' | 'ordinary', cursor?: string) =>
  authed<MembershipAdminApplication[]>(p.adminMembershipApps, { query: { lane, cursor } });

// ---------------- 题库导入 ----------------
// 定稿的题库是一段 JSON：key 只在这段 JSON 里用来互相引用，真正的逻辑 id 由保存接口返回。
// 顺序照后端要求：先建时期（停用）→ 存题 → 配固定必答并启用。

export interface BankFile {
  periods: { key: string; label: string; sortOrder: number; passRule?: 'any' | 'all'; required?: string[]; enabled?: boolean }[];
  questions: {
    key: string;
    period?: string;
    title: string;
    group: string;
    prompt: string;
    notes?: string;
    kind: 'text' | 'single_choice';
    choices?: string[];
    answers: string[];
    status?: 'draft' | 'active';
  }[];
}

export function parseBank(raw: string): BankFile {
  const bank = JSON.parse(raw) as BankFile;
  if (!Array.isArray(bank?.periods) || !Array.isArray(bank?.questions)) throw new Error('需要 periods 和 questions 两个数组。');
  const periodKeys = new Set(bank.periods.map((x) => x.key));
  const questionKeys = new Set(bank.questions.map((q) => q.key));
  for (const q of bank.questions) {
    if (q.period && !periodKeys.has(q.period)) throw new Error(`题目 ${q.key} 指向不存在的时期 ${q.period}。`);
  }
  for (const x of bank.periods) {
    if (x.required?.some((k) => !questionKeys.has(k))) throw new Error(`时期 ${x.key} 的必答题不在题目列表里。`);
    if (x.required?.some((k) => bank.questions.find((q) => q.key === k)?.status === 'draft')) throw new Error(`时期 ${x.key} 的必答题还是草稿。`);
  }
  return bank;
}

export async function importBank(bank: BankFile, onStep: (line: string) => void) {
  const periodIds = new Map<string, string>();
  for (const x of bank.periods) {
    const saved = await savePeriod({ label: x.label, sortOrder: x.sortOrder, enabled: false });
    periodIds.set(x.key, saved.id);
    onStep(`时期「${x.label}」已建好`);
  }
  const questionIds = new Map<string, string>();
  for (const q of bank.questions) {
    const saved = await saveQuestion({
      title: q.title,
      group: q.group,
      prompt: q.prompt,
      notes: q.notes,
      status: q.status ?? 'active',
      kind: q.kind,
      ...(q.kind === 'single_choice' ? { choices: q.choices } : {}),
      answers: q.answers,
      periodIds: q.period ? [periodIds.get(q.period)!] : [],
    });
    questionIds.set(q.key, saved.questionId);
    onStep(`题目「${q.title}」已存`);
  }
  for (const x of bank.periods) {
    await savePeriod({
      id: periodIds.get(x.key),
      label: x.label,
      sortOrder: x.sortOrder,
      enabled: x.enabled ?? true,
      passRule: x.passRule ?? 'any',
      requiredQuestionIds: (x.required ?? []).map((k) => questionIds.get(k)!),
    });
    onStep(`时期「${x.label}」已启用${x.passRule === 'all' ? '，两题全对' : ''}`);
  }
}
