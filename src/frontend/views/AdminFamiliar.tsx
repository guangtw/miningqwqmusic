import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FamiliarAdminAccount,
  FamiliarAdminDetail,
  FamiliarAdminPeriod,
  FamiliarPassRule,
  FamiliarQuestionInput,
  FamiliarQuestionView,
  MembershipAdmissionAdminState,
  MembershipAdmissionPolicyChanges,
} from '@/src/types/membership';
import { QuestionStage } from '../components/FamiliarStages';
import { ErrorState, Loading } from '../components/States';
import {
  actOnRecognition,
  adminAdmission,
  adminPeriods,
  adminRecognitionDetail,
  adminRecognitions,
  allQuestionVersions,
  composePrompt,
  disableQuestion,
  GUESS_WARN,
  importBank,
  parseBank,
  parsePrompt,
  periodGuessRate,
  poolGuessRate,
  resolveStage,
  savePeriod,
  saveQuestion,
  setAdmissionPolicy,
  STAGE_LABEL,
  stagesFor,
  type SideAnswer,
  type StageName,
} from '../lib/familiar';
import { listAuthorizedUsers } from '../lib/membership';
import { toast } from '../lib/toast';

const pad = (n: number) => String(n).padStart(2, '0');
const when = (iso: string | null | undefined) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const STATUS: Record<FamiliarQuestionView['status'], string> = { draft: '草稿', active: '启用', retired: '旧版本', disabled: '已停用' };

/**
 * 熟人暗号管理：策略、时期、题库、资格。
 * 答案写进去就取不回来了，所以编辑题目永远要重新填完整答案；所有权限和规则校验都在服务端
 */
export function FamiliarAdmin() {
  const [periods, setPeriods] = useState<FamiliarAdminPeriod[] | null>(null);
  const [versions, setVersions] = useState<FamiliarQuestionView[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [affected, setAffected] = useState<FamiliarQuestionView | null>(null);

  const load = useCallback(() => {
    Promise.all([adminPeriods(), allQuestionVersions()]).then(
      ([p, q]) => {
        setPeriods(p);
        setVersions(q);
        setError(null);
      },
      (e) => setError(e as Error),
    );
  }, []);
  useEffect(load, [load]);

  if (error && !periods) return <ErrorState error={error} onRetry={load} />;
  if (!periods || !versions) return <Loading rows={4} />;
  return (
    <div className="madmin fadmin">
      <Policy onChange={load} />
      <Periods periods={periods} versions={versions} onChange={load} />
      <Questions periods={periods} versions={versions} onChange={load} onAffected={setAffected} />
      <Recognitions filter={affected} onClearFilter={() => setAffected(null)} />
      <ImportBank onChange={load} />
    </div>
  );
}

// ---------------- 策略 ----------------

const LIMITS: { key: keyof MembershipAdmissionPolicyChanges; label: string; max: number }[] = [
  { key: 'familiarChallengeIpDailyLimit', label: '新挑战 / IP / 天', max: 10000 },
  { key: 'familiarChallengeGlobalDailyLimit', label: '新挑战 / 全站 / 天', max: 100000 },
  { key: 'familiarVerifyUserDailyLimit', label: '提交 / 账号 / 天', max: 1000 },
  { key: 'familiarVerifyIpHourlyLimit', label: '提交 / IP / 小时', max: 10000 },
  { key: 'familiarVerifyGlobalDailyLimit', label: '提交 / 全站 / 天', max: 100000 },
];

function Policy({ onChange }: { onChange: () => void }) {
  const [state, setState] = useState<MembershipAdmissionAdminState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [slots, setSlots] = useState('');
  const load = useCallback(() => {
    adminAdmission().then(
      (s) => {
        setState(s);
        setSlots(s.policy.ordinaryReservedNormalSlots == null ? '' : String(s.policy.ordinaryReservedNormalSlots));
      },
      (e) => toast((e as Error).message),
    );
  }, []);
  useEffect(load, [load]);

  const patch = async (key: string, changes: MembershipAdmissionPolicyChanges) => {
    if (busy) return;
    setBusy(key);
    try {
      await setAdmissionPolicy(changes);
      load();
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!state) return <Loading rows={2} />;
  const p = state.policy;
  const firstMode = p.admissionMode === 'familiar-first';
  const warnings = state.familiar?.warnings ?? [];
  return (
    <section className="madmin-sec reveal" aria-label="策略">
      <div className="section-head">
        <h2>开关</h2>
        <span className="mono faint small">默认全关；切模式前先把题库和时期配好</span>
      </div>
      <div className="madmin-facts">
        <div>
          <small>启用题目</small>
          <b className={warnings.length ? 'warn' : ''}>{state.familiar?.activeQuestions ?? 0} 道</b>
          {warnings.includes('insufficient_questions') && <span className="mono">少于 2 道，开不了验证</span>}
          {warnings.includes('small_question_bank') && <span className="mono">题库偏小，答案外传影响大</span>}
        </div>
        <div>
          <small>有效资格</small>
          <b>{state.familiar?.activeRecognitions ?? 0} 人</b>
        </div>
        <div>
          <small>熟人队列</small>
          <b>{state.queues?.familiar ?? 0} 人</b>
          {state.nextLane === 'familiar' && <span className="mono">下一个候选在这边</span>}
        </div>
        <div>
          <small>普通队列</small>
          <b>{state.queues?.ordinary ?? 0} 人</b>
          {state.nextLane === 'ordinary' && <span className="mono">下一个候选在这边</span>}
        </div>
      </div>
      <div className="madmin-switches fadmin-switches">
        <Switch label="开放熟人验证" help="至少两道启用题才能开。关掉后不能答题，已有资格不受影响。" on={!!p.familiarVerificationEnabled} busy={busy === 'verify'} onFlip={() => void patch('verify', { familiarVerificationEnabled: !p.familiarVerificationEnabled })} />
        <Switch
          label="熟人优先发码"
          help={firstMode ? '现在是 familiar-first：先发有资格的人，普通申请只在没有熟人等待时才可能获批。' : '现在是 legacy：所有申请先来先服务。上线新前端后才能切换。'}
          on={firstMode}
          busy={busy === 'mode'}
          onFlip={() => void patch('mode', { admissionMode: firstMode ? 'legacy' : 'familiar-first' })}
        />
        <Switch label="普通申请也能发码" help="开启前先配好下面的保护空位。" on={!!p.ordinaryDispatchEnabled} busy={busy === 'ordinary'} onFlip={() => void patch('ordinary', { ordinaryDispatchEnabled: !p.ordinaryDispatchEnabled })} />
        <div className="madmin-switch">
          <span>
            <b>保护空位 R</b>
            <small>0 到 9。给熟人留的正常名额，普通申请不占；没有默认值，由你决定。</small>
          </span>
          <form
            className="fadmin-inline"
            onSubmit={(e) => {
              e.preventDefault();
              const n = slots.trim() === '' ? null : Number(slots);
              if (n !== null && (!Number.isInteger(n) || n < 0 || n > 9)) return toast('保护空位要填 0 到 9 的整数，或者留空。');
              void patch('slots', { ordinaryReservedNormalSlots: n });
            }}
          >
            <input className="member-input mono" value={slots} onChange={(e) => setSlots(e.target.value)} inputMode="numeric" placeholder="未配置" aria-label="保护空位" />
            <button className="btn sm" disabled={busy === 'slots'}>
              保存
            </button>
          </form>
        </div>
      </div>
      <details className="madmin-audit fadmin-limits">
        <summary>
          <h3>答题限速</h3>
          <span className="mono faint small">同校园、同家庭的 IP 会共用额度</span>
        </summary>
        <div className="fadmin-limit-grid">
          {LIMITS.map((l) => (
            <Limit key={`${l.key}-${String(p[l.key])}`} label={l.label} max={l.max} value={Number(p[l.key] ?? 0)} onSave={(v) => void patch(l.key, { [l.key]: v })} />
          ))}
        </div>
      </details>
    </section>
  );
}

function Switch({ label, help, on, busy, onFlip }: { label: string; help: string; on: boolean; busy: boolean; onFlip: () => void }) {
  return (
    <div className="madmin-switch">
      <span>
        <b>{label}</b>
        <small>{help}</small>
      </span>
      <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} disabled={busy} onClick={onFlip}>
        <i />
      </button>
    </div>
  );
}

function Limit({ label, value, max, onSave }: { label: string; value: number; max: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const n = Number(v);
  const valid = Number.isInteger(n) && n >= 1 && n <= max;
  return (
    <label className="fadmin-limit">
      <small>{label}</small>
      <input className="member-input mono" value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" onBlur={() => valid && n !== value && onSave(n)} aria-invalid={!valid} />
    </label>
  );
}

// ---------------- 时期 ----------------

function GuessRate({ rate }: { rate: number | null }) {
  if (rate === null) return <span>盲猜率 —</span>;
  const text = rate < 0.01 ? '不到 1%' : `约 ${Math.round(rate * 100)}%`;
  return <span className={rate >= GUESS_WARN ? 'fadmin-risk' : ''}>盲猜{text}</span>;
}

function latestByQuestion(versions: FamiliarQuestionView[]) {
  const groups = new Map<string, FamiliarQuestionView[]>();
  for (const v of versions) groups.set(v.questionId, [...(groups.get(v.questionId) ?? []), v]);
  return [...groups.values()].map((vs) => vs.sort((a, b) => b.version - a.version)).sort((a, b) => a[0].title.localeCompare(b[0].title, 'zh-CN'));
}

interface PeriodDraft {
  id?: string;
  label: string;
  sortOrder: string;
  enabled: boolean;
  passRule: FamiliarPassRule;
  required: [string, string];
}

function Periods({ periods, versions, onChange }: { periods: FamiliarAdminPeriod[]; versions: FamiliarQuestionView[]; onChange: () => void }) {
  const [draft, setDraft] = useState<PeriodDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const logical = useMemo(() => latestByQuestion(versions).map((vs) => vs[0]), [versions]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || busy) return;
    const required = draft.required.filter(Boolean);
    if (required.length === 1 || (required.length === 2 && required[0] === required[1])) return toast('固定必答题要选两道不同的题，或者都不选。');
    setBusy(true);
    try {
      await savePeriod({ ...(draft.id ? { id: draft.id } : {}), label: draft.label.trim(), sortOrder: Number(draft.sortOrder) || 0, enabled: draft.enabled, passRule: draft.passRule, requiredQuestionIds: required });
      setDraft(null);
      onChange();
      toast('时期存好了。');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const edit = (p: FamiliarAdminPeriod) => setDraft({ id: p.id, label: p.label, sortOrder: String(p.sortOrder), enabled: p.enabled, passRule: p.passRule, required: [p.requiredQuestionIds[0] ?? '', p.requiredQuestionIds[1] ?? ''] });
  const titleOf = (id: string) => logical.find((q) => q.questionId === id)?.title ?? '未知题目';
  const active = versions.filter((v) => v.status === 'active');
  const strictIds = new Set(periods.filter((p) => p.passRule === 'all').flatMap((p) => p.requiredQuestionIds));
  const randomRate = poolGuessRate('any', active.filter((q) => !strictIds.has(q.questionId)));

  return (
    <section className="madmin-sec reveal" style={{ '--i': 1 } as React.CSSProperties}>
      <div className="section-head">
        <h2>认识时期</h2>
        <button className="btn sm" onClick={() => setDraft({ label: '', sortOrder: String((periods.at(-1)?.sortOrder ?? 0) + 10), enabled: false, passRule: 'any', required: ['', ''] })}>
          新增时期
        </button>
      </div>
      <p className="muted small fadmin-lead">
        标签是公开的，用户自己选，不代表真的核实过。没配齐题目的时期不会出现在门口。盲猜率是完全不认识的人靠排除法试满三次能过的概率。
        <br />
        「记不清了」入口：{randomRate === null ? '已关闭，随机池不够两题' : <GuessRate rate={randomRate} />}
      </p>
      {draft && (
        <form className="fadmin-form" onSubmit={save}>
          <label className="fadmin-field">
            <small>公开标签</small>
            <input className="member-input" value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required />
          </label>
          <label className="fadmin-field short">
            <small>排序</small>
            <input className="member-input mono" value={draft.sortOrder} inputMode="numeric" onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} />
          </label>
          <label className="fadmin-field short">
            <small>通过规则</small>
            <select className="member-input" value={draft.passRule} onChange={(e) => setDraft({ ...draft, passRule: e.target.value as FamiliarPassRule })}>
              <option value="any">任一题对</option>
              <option value="all">两题全对</option>
            </select>
          </label>
          <label className="fadmin-field fadmin-check">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            <small>启用</small>
          </label>
          {[0, 1].map((i) => (
            <label key={i} className="fadmin-field">
              <small>固定必答题 {i + 1}{draft.passRule === 'all' ? '（必选）' : '（可不选）'}</small>
              <select
                className="member-input"
                value={draft.required[i]}
                onChange={(e) => {
                  const required: [string, string] = [...draft.required];
                  required[i] = e.target.value;
                  setDraft({ ...draft, required });
                }}
              >
                <option value="">不固定</option>
                {logical.map((q) => (
                  <option key={q.questionId} value={q.questionId}>
                    {q.title}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="field-inline fadmin-submit">
            <button className="btn solid sm" disabled={busy}>
              {busy ? '保存中…' : '保存时期'}
            </button>
            <button type="button" className="text-btn" onClick={() => setDraft(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      {!periods.length ? (
        <p className="muted small">还没有时期。</p>
      ) : (
        <div className="admin-list madmin-list" role="list">
          {periods.map((p) => (
            <div key={p.id} role="listitem" className="admin-row madmin-row">
              <span className="admin-who">
                <span className="t">{p.label}</span>
                <span className="a">
                  {p.passRule === 'all' ? '两题全对' : '任一题对'}
                  {p.requiredQuestionIds.length > 0 && ` · 固定：${p.requiredQuestionIds.map(titleOf).join('、')}`}
                </span>
              </span>
              <span className={`madmin-status ${p.available ? 's-redeemed' : p.enabled ? 's-blocked' : 's-cancelled'}`}>{p.available ? '门口可选' : p.enabled ? '题没配齐' : '已停用'}</span>
              <span className="madmin-when mono">
                定向 {p.targetedQuestions} · 通用 {p.generalQuestions} · 排序 {p.sortOrder}
                {' · '}
                <GuessRate rate={periodGuessRate(p, active, strictIds)} />
              </span>
              <span className="madmin-acts">
                <button className="text-btn" onClick={() => edit(p)}>
                  编辑
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------- 题库 ----------------

interface QuestionDraft {
  questionId?: string;
  title: string;
  group: string;
  kind: 'text' | 'single_choice';
  status: 'draft' | 'active';
  notes: string;
  periodIds: string[];
  text: string;
  stage: StageName | '';
  kicker: string;
  hint: string;
  fields: string;
  suffix: string;
  was: string;
  choices: string;
  answers: string;
}

const emptyDraft = (): QuestionDraft => ({ title: '', group: '', kind: 'single_choice', status: 'draft', notes: '', periodIds: [], text: '', stage: '', kicker: '', hint: '', fields: '', suffix: '', was: '', choices: '', answers: '' });

function draftOf(q: FamiliarQuestionView): QuestionDraft {
  const s = parsePrompt(q.prompt);
  return {
    questionId: q.questionId,
    title: q.title,
    group: q.group,
    kind: q.kind,
    status: 'active',
    notes: q.notes ?? '',
    periodIds: q.periodIds ?? [],
    text: s.text,
    stage: s.stage ?? '',
    kicker: s.kicker ?? '',
    hint: s.hint ?? '',
    fields: s.fields.join('|'),
    suffix: s.suffix ?? '',
    was: s.was ?? '',
    choices: q.choices.map((c) => c.label).join('\n'),
    // 答案后台取不回来，这里永远是空的，要重新填
    answers: '',
  };
}

const promptOf = (d: QuestionDraft) =>
  composePrompt({
    text: d.text,
    stage: d.stage || undefined,
    kicker: d.kicker,
    hint: d.hint,
    fields: d.fields.split('|').map((x) => x.trim()).filter(Boolean).slice(0, 2),
    suffix: d.suffix,
    was: d.was,
  });

function Questions({ periods, versions, onChange, onAffected }: { periods: FamiliarAdminPeriod[]; versions: FamiliarQuestionView[]; onChange: () => void; onAffected: (q: FamiliarQuestionView) => void }) {
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const groups = useMemo(() => latestByQuestion(versions), [versions]);
  const periodName = (id: string) => periods.find((p) => p.id === id)?.label ?? '已不存在';

  const stop = async (q: FamiliarQuestionView, all: boolean) => {
    const key = `${q.id}:${all}`;
    if (armed !== key) return setArmed(key);
    setArmed(null);
    try {
      await disableQuestion(q.id, all);
      toast(all ? '整道题停用了，用到它的未完成挑战也作废了。' : '这个版本停用了。');
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <section className="madmin-sec reveal" style={{ '--i': 2 } as React.CSSProperties}>
      <div className="section-head">
        <h2>题库</h2>
        <button className="btn sm" onClick={() => setDraft(emptyDraft())}>
          新增题目
        </button>
      </div>
      <p className="muted small fadmin-lead">每次保存都生成新版本，答案写入后取不回。答案泄露要点「停用整题」，只改答案挡不住进行中的挑战。</p>
      {draft && <QuestionEditor draft={draft} setDraft={setDraft} periods={periods} onSaved={onChange} />}
      {!groups.length ? (
        <p className="muted small">还没有题目。</p>
      ) : (
        <div className="fadmin-questions">
          {groups.map((vs) => {
            const q = vs[0];
            const spec = parsePrompt(q.prompt);
            const stage = resolveStage(q.kind, spec.stage, q.choices.length);
            return (
              <details key={q.questionId} className="fadmin-q">
                <summary>
                  <span className="admin-who">
                    <span className="t">{q.title}</span>
                    <span className="a">{spec.text}</span>
                  </span>
                  <span className={`madmin-status q-${q.status}`}>{STATUS[q.status]}</span>
                  <span className="madmin-when mono">
                    v{q.version} · {q.kind === 'text' ? '填空' : `单选 ${q.choices.length} 项`} · {STAGE_LABEL[stage].replace(/（.*）/, '')}
                  </span>
                </summary>
                <div className="fadmin-q-body">
                  <p className="small">
                    <span className="faint">时期：</span>
                    {q.periodIds?.length ? q.periodIds.map(periodName).join('、') : '通用题'}
                    <span className="faint"> · 分组：</span>
                    {q.group}
                    <span className="faint"> · 答案：</span>
                    {q.answerCount} 种写法
                  </p>
                  {q.choices.length > 0 && <p className="small"><span className="faint">选项：</span>{q.choices.map((c) => c.label).join('、')}</p>}
                  {q.notes && <p className="small"><span className="faint">备注：</span>{q.notes}</p>}
                  <div className="field-inline">
                    <button className="btn sm" onClick={() => setDraft(draftOf(q))}>
                      编辑（新版本）
                    </button>
                    <button className="btn sm" onClick={() => onAffected(q)}>
                      谁凭这版通过了
                    </button>
                    <button className={`btn sm ${armed === `${q.id}:true` ? 'danger' : ''}`} onClick={() => void stop(q, true)}>
                      {armed === `${q.id}:true` ? '再点一次，停用整题' : '停用整题'}
                    </button>
                  </div>
                  <ol className="madmin-log mono fadmin-versions" aria-label="版本历史">
                    {vs.map((v) => (
                      <li key={v.id}>
                        <span className="faint">{when(v.createdAt)}</span>
                        <b>v{v.version} {STATUS[v.status]}</b>
                        <span className="madmin-log-details">
                          {v.answerCount} 种答案写法
                          {(v.status === 'active' || v.status === 'draft') && (
                            <button className={`text-btn ${armed === `${v.id}:false` ? 'danger' : ''}`} onClick={() => void stop(v, false)}>
                              {armed === `${v.id}:false` ? '确认停用' : '停用这版'}
                            </button>
                          )}
                          <button className="text-btn" onClick={() => onAffected(v)}>
                            查账号
                          </button>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

function QuestionEditor({ draft, setDraft, periods, onSaved }: { draft: QuestionDraft; setDraft: (d: QuestionDraft | null) => void; periods: FamiliarAdminPeriod[]; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SideAnswer | null>(null);
  const set = (patch: Partial<QuestionDraft>) => setDraft({ ...draft, ...patch });
  const prompt = promptOf(draft);
  const choices = lines(draft.choices);
  const stage = resolveStage(draft.kind, draft.stage || undefined, choices.length);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (prompt.length > 500) return toast('题干加展示设置一共不能超过 500 字。');
    const answers = lines(draft.answers);
    if (!answers.length) return toast('答案要重新填，后台取不回旧答案。');
    const input: FamiliarQuestionInput = {
      ...(draft.questionId ? { questionId: draft.questionId } : {}),
      title: draft.title.trim(),
      group: draft.group.trim(),
      prompt,
      notes: draft.notes.trim(),
      status: draft.status,
      kind: draft.kind,
      ...(draft.kind === 'single_choice' ? { choices } : { choices: [] }),
      answers,
      periodIds: draft.periodIds,
    };
    setBusy(true);
    try {
      await saveQuestion(input);
      toast('存好了，生成了新版本。');
      setDraft(null);
      onSaved();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="fadmin-editor" onSubmit={save}>
      <div className="fadmin-form">
        <label className="fadmin-field">
          <small>内部标题（用户看不到）</small>
          <input className="member-input" value={draft.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} required />
        </label>
        <label className="fadmin-field">
          <small>内部分组（抽题时优先跨组）</small>
          <input className="member-input" value={draft.group} maxLength={100} onChange={(e) => set({ group: e.target.value })} required />
        </label>
        <label className="fadmin-field short">
          <small>题型</small>
          <select className="member-input" value={draft.kind} onChange={(e) => set({ kind: e.target.value as QuestionDraft['kind'], stage: '' })}>
            <option value="single_choice">单选</option>
            <option value="text">填空</option>
          </select>
        </label>
        <label className="fadmin-field short">
          <small>状态</small>
          <select className="member-input" value={draft.status} onChange={(e) => set({ status: e.target.value as QuestionDraft['status'] })}>
            <option value="draft">草稿</option>
            <option value="active">启用</option>
          </select>
        </label>
        <fieldset className="fadmin-field wide fadmin-periods">
          <small>适用时期（不选 = 通用题）</small>
          {periods.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={draft.periodIds.includes(p.id)} onChange={(e) => set({ periodIds: e.target.checked ? [...draft.periodIds, p.id] : draft.periodIds.filter((x) => x !== p.id) })} />
              {p.label}
            </label>
          ))}
        </fieldset>
        <label className="fadmin-field wide">
          <small>用户看到的题干</small>
          <textarea className="member-input" rows={2} value={draft.text} onChange={(e) => set({ text: e.target.value })} required />
        </label>
        <label className="fadmin-field">
          <small>展示形式</small>
          <select className="member-input" value={draft.stage} onChange={(e) => set({ stage: e.target.value as StageName | '' })}>
            <option value="">默认</option>
            {stagesFor(draft.kind).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="fadmin-field">
          <small>提示（可不填）</small>
          <input className="member-input" value={draft.hint} onChange={(e) => set({ hint: e.target.value })} />
        </label>
        {(stage === 'chalk' || stage === 'roster' || stage === 'plaque' || stage === 'dorms' || stage === 'idcard') && (
          <label className="fadmin-field">
            <small>{stage === 'dorms' ? '搬到楼下的东西' : stage === 'chalk' ? '黑板抬头' : stage === 'plaque' ? '门牌小字' : stage === 'idcard' ? '栏目名' : '本子抬头'}</small>
            <input className="member-input" value={draft.kicker} onChange={(e) => set({ kicker: e.target.value })} />
          </label>
        )}
        {(stage === 'roster' || stage === 'notebook') && (
          <label className="fadmin-field">
            <small>线索，用 | 隔开，最多两个</small>
            <input className="member-input" value={draft.fields} onChange={(e) => set({ fields: e.target.value })} placeholder="线索甲|线索乙" />
          </label>
        )}
        {(stage === 'plaque' || stage === 'roster' || stage === 'notebook') && (
          <label className="fadmin-field">
            <small>输入框后面的字</small>
            <input className="member-input" value={draft.suffix} onChange={(e) => set({ suffix: e.target.value })} />
          </label>
        )}
        {stage === 'signboard' && (
          <label className="fadmin-field">
            <small>被划掉的旧名字</small>
            <input className="member-input" value={draft.was} onChange={(e) => set({ was: e.target.value })} />
          </label>
        )}
        {draft.kind === 'single_choice' && (
          <label className="fadmin-field wide">
            <small>选项，每行一个（2 到 12 个）</small>
            <textarea className="member-input" rows={4} value={draft.choices} onChange={(e) => set({ choices: e.target.value })} />
          </label>
        )}
        <label className="fadmin-field wide">
          <small>{draft.kind === 'single_choice' ? '正确答案：和某个选项一字不差' : '可接受的答案，每行一种写法（全半角、大小写、空格已自动兼容）'}{draft.questionId && '。要重新填完整'}</small>
          <textarea className="member-input" rows={draft.kind === 'single_choice' ? 1 : 3} value={draft.answers} onChange={(e) => set({ answers: e.target.value })} autoComplete="off" spellCheck={false} />
        </label>
        <label className="fadmin-field wide">
          <small>风险备注（内部）</small>
          <input className="member-input" value={draft.notes} maxLength={500} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <div className="field-inline fadmin-submit">
          <button className="btn solid sm" disabled={busy}>
            {busy ? '保存中…' : draft.questionId ? '存成新版本' : '保存题目'}
          </button>
          <button type="button" className="text-btn" onClick={() => setDraft(null)}>
            取消
          </button>
          <span className="mono faint small">{prompt.length} / 500</span>
        </div>
      </div>
      <div className="fq fq-preview" aria-label="用户看到的样子">
        <span className="fq-preview-tag mono">预览</span>
        {draft.text.trim() ? (
          <QuestionStage
            question={{ slot: 0, prompt, kind: draft.kind, options: draft.kind === 'single_choice' ? choices.map((label, i) => ({ id: String(i), label })) : undefined }}
            spec={parsePrompt(prompt)}
            answer={preview}
            onAnswer={setPreview}
            name="fq-preview"
          />
        ) : (
          <p className="fq-say">写下题干就能看到样子。</p>
        )}
      </div>
    </form>
  );
}

// ---------------- 资格 ----------------

function Recognitions({ filter, onClearFilter }: { filter: FamiliarQuestionView | null; onClearFilter: () => void }) {
  const [rows, setRows] = useState<FamiliarAdminAccount[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; email: string; nickname: string | null }[]>([]);
  const [detail, setDetail] = useState<FamiliarAdminDetail | null>(null);
  const versionId = filter?.id;

  const reload = useCallback(() => {
    adminRecognitions({ versionId }).then(
      (r) => {
        setRows(r);
        setMore(r.length >= 50);
        setError(null);
      },
      (e) => setError(e as Error),
    );
  }, [versionId]);
  useEffect(reload, [reload]);

  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      listAuthorizedUsers(q, ctrl.signal).then(
        (r) => setHits(r.slice(0, 6)),
        () => undefined,
      );
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const next = () => {
    const last = rows?.at(-1)?.userId;
    if (!last) return;
    adminRecognitions({ versionId, cursor: last }).then(
      (r) => {
        setRows((x) => [...(x ?? []), ...r]);
        setMore(r.length >= 50);
      },
      (e) => toast((e as Error).message),
    );
  };
  const open = (userId: string) =>
    adminRecognitionDetail(userId).then(setDetail, (e) => toast((e as Error).message));

  return (
    <section className="madmin-sec reveal" style={{ '--i': 3 } as React.CSSProperties}>
      <div className="section-head">
        <h2>熟人资格</h2>
        <span className="mono faint small">资格只表示对上过暗号，不等于核实过现实身份</span>
      </div>
      <label className="admin-search fadmin-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按邮箱或昵称找人，查看或手动授予" aria-label="查找账号" />
      </label>
      {hits.length > 0 && (
        <div className="admin-list madmin-list" role="list">
          {hits.map((u) => (
            <button key={u.id} className="admin-row madmin-row fadmin-hit" onClick={() => void open(u.id)}>
              <span className="admin-who">
                <span className="t">{u.nickname || u.email.split('@')[0]}</span>
                <span className="a">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {detail && <RecognitionDetail detail={detail} setDetail={setDetail} onChange={reload} />}
      {filter && (
        <p className="small fadmin-filter">
          正在看凭「{filter.title} v{filter.version}」通过过的账号（含后来被撤销的）。
          <button className="text-btn" onClick={onClearFilter}>
            看全部
          </button>
        </p>
      )}
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !rows ? (
        <Loading rows={2} />
      ) : !rows.length ? (
        <p className="muted small">{filter ? '没有人凭这个版本通过。' : '还没有人有资格。'}</p>
      ) : (
        <div className="admin-list madmin-list" role="list">
          {rows.map((a) => (
            <div key={a.userId} role="listitem" className="admin-row madmin-row">
              <span className="admin-who">
                <span className="t">{a.user.nickname || a.user.email.split('@')[0]}</span>
                <span className="a">{a.user.email}</span>
              </span>
              <span className={`madmin-status ${a.status === 'active' ? 's-redeemed' : 's-blocked'}`}>{a.status === 'active' ? '有效' : '已撤销'}</span>
              <span className="madmin-when mono">
                {a.source === 'manual' ? '人工授予' : '答题通过'} · {when(a.status === 'active' ? a.verifiedAt : a.revokedAt)}
                {a.selfServiceBlocked && ' · 禁止自行恢复'}
              </span>
              <span className="madmin-acts">
                <button className="text-btn" onClick={() => void open(a.userId)}>
                  详情
                </button>
              </span>
            </div>
          ))}
          {more && (
            <button className="btn sm ghost madmin-more" onClick={next}>
              再看 50 条
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function RecognitionDetail({ detail, setDetail, onChange }: { detail: FamiliarAdminDetail; setDetail: (d: FamiliarAdminDetail | null) => void; onChange: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const r = detail.recognition;
  const act = async (action: 'grant' | 'revoke' | 'unblock') => {
    if (busy) return;
    if (!reason.trim()) return toast('写一句简短的原因，别写答案。');
    setBusy(true);
    try {
      setDetail(await actOnRecognition({ userId: detail.user.id, action, reason: reason.trim() }));
      setReason('');
      onChange();
      toast(action === 'grant' ? '授予了资格（不会开通会员）。' : action === 'revoke' ? '撤销了。未兑换的熟人优先码同时作废，已兑换的会员保留。' : '解除了，对方以后可以再自行答题。');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fadmin-detail">
      <div className="fadmin-detail-head">
        <span className="admin-who">
          <span className="t">{detail.user.nickname || detail.user.email.split('@')[0]}</span>
          <span className="a">{detail.user.email}</span>
        </span>
        <span className={`madmin-status ${r?.status === 'active' ? 's-redeemed' : r ? 's-blocked' : 's-cancelled'}`}>{r ? (r.status === 'active' ? '资格有效' : '已撤销') : '尚未验证'}</span>
        <button className="text-btn" onClick={() => setDetail(null)}>
          收起
        </button>
      </div>
      <h4>通过依据</h4>
      {!detail.evidence.length ? (
        <p className="muted small">还没有依据。</p>
      ) : (
        <ul className="fadmin-evidence">
          {detail.evidence.map((e) => (
            <li key={e.id}>
              <span className="mono faint">{when(e.createdAt)}</span> {e.source === 'manual' ? `人工授予：${e.reason ?? ''}` : `答题通过（${e.passRule === 'all' ? '两题全对' : '任一题对'}）`}
              {e.periodLabel && <span className="faint"> · 用户自选时期：{e.periodLabel}</span>}
              {e.matchedQuestions.map((q) => (
                <span key={q.id} className="fadmin-evidence-q small">
                  答对 {q.title} v{q.version}：{parsePrompt(q.prompt).text}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      <h4>最近挑战</h4>
      {!detail.recentChallenges.length ? (
        <p className="muted small">没有挑战记录。</p>
      ) : (
        <ul className="fadmin-evidence mono">
          {detail.recentChallenges.map((c) => (
            <li key={c.id}>
              {when(c.createdAt)} · 用了 {c.attempts}/3 次 · {c.periodLabel ?? '未选时期'} · {c.consumedAt ? '已通过' : c.invalidatedAt ? '已失效' : Date.parse(c.expiresAt) < Date.now() ? '已过期' : '进行中'}
            </li>
          ))}
        </ul>
      )}
      <div className="fadmin-actions">
        <input className="member-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="原因（必填，别写答案）" aria-label="操作原因" />
        {r?.status !== 'active' && (
          <button className="btn sm" disabled={busy} onClick={() => void act('grant')}>
            授予资格
          </button>
        )}
        {r?.status === 'active' && (
          <button className="btn sm danger" disabled={busy} onClick={() => void act('revoke')}>
            撤销资格
          </button>
        )}
        {r?.selfServiceBlocked && (
          <button className="btn sm" disabled={busy} onClick={() => void act('unblock')}>
            允许再自行答题
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- 题库导入 ----------------

function ImportBank({ onChange }: { onChange: () => void }) {
  const [raw, setRaw] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setLog([]);
    try {
      await importBank(parseBank(raw), (line) => setLog((x) => [...x, line]));
      setLog((x) => [...x, '全部完成。']);
      setRaw('');
      onChange();
    } catch (e) {
      setLog((x) => [...x, `停在这里：${(e as Error).message}`]);
    } finally {
      setBusy(false);
      onChange();
    }
  };
  return (
    <section className="madmin-sec reveal" style={{ '--i': 4 } as React.CSSProperties}>
      <details className="madmin-audit">
        <summary>
          <h2>导入定稿题库</h2>
          <span className="mono faint small">一次录好时期、题目和必答配置；每导一次都会新建，只导一次</span>
        </summary>
        <div className="fadmin-import">
          <textarea className="member-input mono" rows={6} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="贴上题库 JSON" autoComplete="off" spellCheck={false} aria-label="题库 JSON" />
          <button className="btn solid sm" disabled={busy || !raw.trim()} onClick={() => void run()}>
            {busy ? '导入中…' : '开始导入'}
          </button>
          {log.length > 0 && (
            <ol className="madmin-log mono">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </section>
  );
}
