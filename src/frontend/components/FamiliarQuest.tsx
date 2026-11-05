import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FamiliarChallengeView, FamiliarPeriodOption, FamiliarSlotAnswer } from '@/src/types/membership';
import { ApiError } from '../api/http';
import { authStore } from '../lib/account';
import { dropLayer, popLayer, pushLayer } from '../lib/backstack';
import {
  answerIsEmpty,
  canSubmit,
  familiarNow,
  familiarStore,
  fetchFamiliar,
  hasLiveChallenge,
  openChallenge,
  parsePrompt,
  slotPayload,
  submitAnswers,
  type SideAnswer,
} from '../lib/familiar';
import { motionEnabled } from '../lib/settings';
import { useStore } from '../lib/store';
import { NeedleMark, QuestionStage, SideDisc } from './FamiliarStages';

// 对暗号：唱片行打烊了，后门开着一扇小窗。
// 敲门 → 窗里的人问什么时候认识的 → 从箱子里抽一张单曲 → A、B 两面各一题 → 落针。
// 放得出声就开门，放不出来只说「这张放不出声」，不说错在哪面。
// 没对上不代表不认识，所以不出现「陌生人」这种话，普通申请一直都在。

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (iso: string | null | undefined) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};
const shortDate = (iso: string | null | undefined) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

type Mood = 'curious' | 'idle' | 'squint' | 'closed' | 'happy' | 'asleep';

/** 小窗里那双眼睛：瞳孔是两张小唱片，跟着指针看 */
export function Hatch({ mood = 'idle', small = false }: { mood?: Mood; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (small || !motionEnabled()) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, d / 260);
        el.style.setProperty('--ex', `${((dx / d) * reach * 100).toFixed(1)}%`);
        el.style.setProperty('--ey', `${((dy / d) * reach * 60).toFixed(1)}%`);
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', move);
    };
  }, [small]);
  return (
    <div ref={ref} className={`hatch ${small ? 'small' : ''}`} data-mood={mood} aria-hidden="true">
      <i className="hatch-rivet a" />
      <i className="hatch-rivet b" />
      <i className="hatch-rivet c" />
      <i className="hatch-rivet d" />
      <div className="hatch-window">
        {[0, 1].map((n) => (
          <div key={n} className="hatch-eye">
            <i className="brow" />
            <div className="ball">
              <i className="pupil" />
              <i className="lid top" />
              <i className="lid bottom" />
            </div>
          </div>
        ))}
        <i className="hatch-shutter" />
      </div>
    </div>
  );
}

/** 窗里的人说话：一个字一个字冒出来；读屏直接读整句 */
function Say({ text }: { text: string }) {
  const [n, setN] = useState(motionEnabled() ? 0 : text.length);
  useEffect(() => {
    if (!motionEnabled()) return setN(text.length);
    setN(0);
    const t = window.setInterval(() => {
      setN((x) => {
        if (x >= text.length) window.clearInterval(t);
        return x + 1;
      });
    }, 34);
    return () => window.clearInterval(t);
  }, [text]);
  return (
    <p className="fq-say">
      <span className="sr-only" aria-live="polite">
        {text}
      </span>
      <span aria-hidden="true">
        {text.slice(0, n)}
        <i className="fq-say-ghost">{text.slice(n)}</i>
      </span>
    </p>
  );
}

// ---------------- 第一幕：抽一张单曲 ----------------

const SLEEVES = ['arcs', 'sun', 'bars', 'dots'] as const;

function Crate({
  periods,
  canRandom,
  busy,
  onPick,
  onSkip,
}: {
  periods: FamiliarPeriodOption[];
  canRandom: boolean;
  busy: string | null;
  onPick: (id: string | null) => void;
  onSkip: () => void;
}) {
  return (
    <div className="fq-crate-wrap">
      <div className="fq-crate" role="group" aria-label="什么时候认识的">
        {periods.map((x, i) => (
          <button key={x.id} type="button" className={`sleeve art-${SLEEVES[i % SLEEVES.length]} ${busy === x.id ? 'pulled' : ''}`} disabled={!!busy} onClick={() => onPick(x.id)} style={{ '--i': i } as React.CSSProperties}>
            <i className="sleeve-disc" aria-hidden="true" />
            <span className="sleeve-face">
              <small className="mono">45 RPM · A/B</small>
              <b>{x.label}</b>
            </span>
          </button>
        ))}
        {canRandom && (
          <button type="button" className={`sleeve art-white ${busy === 'random' ? 'pulled' : ''}`} disabled={!!busy} onClick={() => onPick(null)} style={{ '--i': periods.length } as React.CSSProperties}>
            <i className="sleeve-disc" aria-hidden="true" />
            <span className="sleeve-face">
              <small className="mono">WHITE LABEL</small>
              <b>记不清了</b>
              <em>随便抽一张</em>
            </span>
          </button>
        )}
        <i className="fq-crate-front" aria-hidden="true" />
      </div>
      <p className="fq-pickhelp">抽定了就是这张，24 小时内换不了。</p>
      <button type="button" className="fq-skip" onClick={onSkip}>
        不对暗号了，直接去申请
      </button>
    </div>
  );
}

// ---------------- 第二幕：A、B 两面 ----------------

const NODS = ['嗯哼。', '这样啊。', '记下了。', '哦？', '行，先这么写着。'];

function Quiz({
  challenge,
  answers,
  setAnswer,
  side,
  flip,
  flipping,
  note,
  onDrop,
}: {
  challenge: FamiliarChallengeView;
  answers: (SideAnswer | null)[];
  setAnswer: (slot: number, a: SideAnswer) => void;
  side: number;
  flip: (to: number) => void;
  flipping: boolean;
  note: string | null;
  onDrop: () => void;
}) {
  const q = challenge.questions[side];
  const spec = useMemo(() => parsePrompt(q.prompt), [q.prompt]);
  const ready = canSubmit(challenge.passRule, answers);
  const other = side === 0 ? 1 : 0;
  const otherEmpty = answerIsEmpty(answers[other]);
  const thisEmpty = answerIsEmpty(answers[side]);
  // 这面答完、另一面还空着：主按钮是翻面。全对规则下没答完也落不了针
  const flipFirst = otherEmpty && !thisEmpty;
  const needsBoth = challenge.passRule === 'all' && !ready;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (flipFirst) flip(other);
    else if (ready) onDrop();
  };

  return (
    <form className="fq-quiz" onSubmit={submit} noValidate>
      <div className="fq-quizbar">
        <div className="fq-sides" role="group" aria-label="翻面">
          {challenge.questions.map((x) => (
            <SideDisc key={x.slot} letter={x.slot === 0 ? 'A' : 'B'} on={x.slot === side} done={!answerIsEmpty(answers[x.slot])} onClick={() => x.slot !== side && flip(x.slot)} />
          ))}
          {challenge.period && <span className="fq-period mono">{challenge.period.label}</span>}
        </div>
        <div className="fq-chances" aria-label={`还能落针 ${challenge.attemptsRemaining} 次`}>
          {[0, 1, 2].map((i) => (
            <NeedleMark key={i} on={i < challenge.attemptsRemaining} />
          ))}
        </div>
      </div>

      <div className="fq-sidewrap">
        <div className={`fq-side ${flipping ? 'out' : ''}`} key={side}>
          <QuestionStage question={q} spec={spec} answer={answers[side]} onAnswer={(a) => setAnswer(side, a)} name={`fq-slot-${side}`} />
        </div>
      </div>

      <div className="fq-actions">
        {note && <p className="fq-note">{note}</p>}
        <div className="fq-actionrow">
          {flipFirst ? (
            <>
              <button className="btn solid fq-primary">翻到 {other === 1 ? 'B' : 'A'} 面</button>
              {ready && (
                <button type="button" className="text-btn fq-alt" onClick={onDrop}>
                  留白，直接落针
                </button>
              )}
            </>
          ) : (
            <>
              <button className="btn solid fq-primary" disabled={!ready}>
                落针
              </button>
              <button type="button" className="text-btn fq-alt" onClick={() => flip(other)}>
                翻到 {other === 1 ? 'B' : 'A'} 面
              </button>
            </>
          )}
        </div>
        {needsBoth && !flipFirst && <p className="fq-rule mono">两面都写了才能落针</p>}
      </div>
    </form>
  );
}

// ---------------- 落针 ----------------

function Deck({ state }: { state: 'spin' | 'pass' | 'fail' }) {
  return (
    <div className="fq-deck" data-state={state} aria-hidden="true">
      <div className="fq-platter">
        <div className="fq-disc">
          <i className="fq-disc-label">
            <b>A</b>
          </i>
        </div>
      </div>
      <svg className="fq-arm" viewBox="0 0 120 220">
        <circle className="base" cx="92" cy="28" r="18" />
        <path className="rod" d="M92 28 L96 142 L58 196" />
        <path className="head" d="M66 186 l-16 21 9 7 16 -21 z" />
        <circle className="pivot" cx="92" cy="28" r="7" />
      </svg>
    </div>
  );
}

// ---------------- 开门 ----------------

function RegularCard({ period, verifiedAt }: { period: string | null | undefined; verifiedAt: string | null | undefined }) {
  return (
    <div className="regular-card">
      <span className="regular-script">the Regular</span>
      <b className="regular-title">熟客</b>
      <dl>
        {period && (
          <div>
            <dt>认识于</dt>
            <dd>{period}</dd>
          </div>
        )}
        <div>
          <dt>对上暗号</dt>
          <dd>{dateOf(verifiedAt)}</dd>
        </div>
      </dl>
      <i className="regular-stamp" aria-hidden="true">
        <b>对上了</b>
      </i>
      <i className="regular-disc" aria-hidden="true" />
    </div>
  );
}

const CONFETTI = Array.from({ length: 16 }, (_, i) => i);

function Opened({ period, verifiedAt, fresh, onClose }: { period: string | null | undefined; verifiedAt: string | null | undefined; fresh: boolean; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div className={`fq-open ${fresh ? 'fresh' : ''}`}>
      {fresh && (
        <div className="fq-notes" aria-hidden="true">
          {CONFETTI.map((i) => (
            <i key={i} style={{ '--i': i } as React.CSSProperties} />
          ))}
        </div>
      )}
      <h2 className="fq-welcome">{fresh ? '是你啊。进来坐。' : '你的熟客卡'}</h2>
      <RegularCard period={period} verifiedAt={verifiedAt} />
      <p className="fq-open-note">这张卡一直有效，不算会员，也不会自动开通什么。下次来申请，我认得你。</p>
      <button ref={ref} className="btn solid" onClick={onClose}>
        收好，回去
      </button>
    </div>
  );
}

// ---------------- 今天到此为止 ----------------

function Spent({ until, recalled, onRetry, onClose }: { until: string; recalled: boolean; onRetry: () => void; onClose: () => void }) {
  const [now, setNow] = useState(familiarNow);
  useEffect(() => {
    const t = window.setInterval(() => setNow(familiarNow()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = Date.parse(until) - now;
  const over = !(left > 0);
  return (
    <div className="fq-spent">
      <div className="fq-doorsign">
        <i className="fq-doorsign-string" aria-hidden="true" />
        <div className="fq-doorsign-board">
          <b>{recalled ? '这张收回了' : '今日打烊'}</b>
          <span className="mono">{over ? '可以再敲门了' : `${clock(left)} 后再敲门`}</span>
        </div>
      </div>
      <p className="fq-open-note">{recalled ? '这一组暗号被我收回了，不是你的问题。' : '想不起来也正常，这种事谁记得那么清。'}普通申请不用对暗号，随时可以排。</p>
      <div className="fq-actionrow">
        {over ? (
          <button className="btn solid" onClick={onRetry}>
            再敲一次门
          </button>
        ) : (
          <button className="btn solid" onClick={onClose}>
            去普通申请
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- 舞台 ----------------

type Scene =
  | { name: 'knock' }
  | { name: 'door' }
  | { name: 'quiz' }
  | { name: 'needle'; state: 'spin' | 'pass' | 'fail' }
  | { name: 'open'; fresh: boolean }
  | { name: 'spent'; recalled: boolean }
  | { name: 'paused'; text: string };

const SPIN_MS = 2000;
const FAIL_MS = 1250;
const PASS_MS = 1500;
const FLIP_MS = 190;

const ruleLine = (c: FamiliarChallengeView) =>
  c.passRule === 'all' ? '这张得两面都对上才放得出声。慢慢想。' : '两面答对一面，我就信你。拿不准的那面可以空着。';

const failLine = (left: number, c: FamiliarChallengeView) => {
  const tail = c.passRule === 'all' ? '两面都得对。' : '';
  if (left <= 1) return `还是放不出声。${tail}只剩最后一次了，别急。`;
  return `嗯……这张放不出声。${tail}你写的我都留着，再想想？`;
};

function Quest({ onClose }: { onClose: () => void }) {
  const [scene, setScene] = useState<Scene>({ name: 'knock' });
  const [say, setSay] = useState('咚、咚、咚……');
  const [mood, setMood] = useState<Mood>('closed');
  const [challenge, setChallenge] = useState<FamiliarChallengeView | null>(null);
  const [answers, setAnswers] = useState<(SideAnswer | null)[]>([null, null]);
  const [side, setSide] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const status = useStore(familiarStore, (s) => s.status);
  const timers = useRef<number[]>([]);
  const nod = useRef(0);
  const lastNod = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, motionEnabled() ? ms : 0));
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const showChallenge = (c: FamiliarChallengeView) => {
    setChallenge(c);
    if (!c.available || c.attemptsRemaining <= 0 || !c.questions.length) {
      setMood('asleep');
      setSay('今天先这样吧。');
      setScene({ name: 'spent', recalled: c.attemptsRemaining > 0 });
      return;
    }
    setMood('idle');
    setSay(ruleLine(c));
    setScene({ name: 'quiz' });
  };

  const pause = (text: string) => {
    setMood('asleep');
    setSay(text);
    setScene({ name: 'paused', text });
  };

  /** 进门或者重新进门：有资格就看卡，有没到期的题就恢复，否则才让选时期 */
  const enter = async () => {
    setNote(null);
    try {
      const s = await fetchFamiliar();
      if (s.verified) {
        setMood('happy');
        setSay('哟，是你。');
        setScene({ name: 'open', fresh: false });
        return;
      }
      if (!s.canVerify) {
        pause(s.reason === 'email_verification_required' ? '先确认一下账号邮箱，再来敲门。' : '今晚暗号局歇业，改天再来。');
        return;
      }
      if (hasLiveChallenge(s)) {
        showChallenge(await openChallenge());
        return;
      }
      if (!s.periodOptions?.length && !s.canUseRandom) {
        pause('今晚暗号局歇业，改天再来。');
        return;
      }
      setMood('curious');
      setSay('这么晚了……看着有点眼熟。咱们是什么时候认识的？');
      setScene({ name: 'door' });
    } catch (e) {
      pause((e as Error).message);
    }
  };

  // 门先响两下，窗才拉开
  useEffect(() => {
    later(760, () => void enter());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (id: string | null) => {
    if (busy) return;
    setBusy(id ?? 'random');
    setNote(null);
    try {
      const c = await openChallenge(id);
      later(420, () => {
        setBusy(null);
        showChallenge(c);
      });
    } catch (e) {
      setBusy(null);
      const err = e as ApiError;
      if (err.code === 5925 || err.code === 5920) await enter();
      setNote(err.message);
    }
  };

  const setAnswer = (slot: number, a: SideAnswer) => {
    setAnswers((prev) => prev.map((x, i) => (i === slot ? a : x)));
    setNote(null);
    // 不管选了哪个，反应都一样，看不出对错
    const now = performance.now();
    if (a.kind === 'choice' && now - lastNod.current > 900) {
      lastNod.current = now;
      setSay(NODS[nod.current++ % NODS.length]);
    }
  };

  const flip = (to: number) => {
    if (!motionEnabled()) return setSide(to);
    setFlipping(true);
    later(FLIP_MS, () => {
      setSide(to);
      setFlipping(false);
    });
  };

  const needleBack = (c: FamiliarChallengeView) => {
    later(FAIL_MS, () => setScene({ name: 'quiz' }));
    setChallenge(c);
  };

  /** 判定这段时间窗里的人闭眼听；至少转够两秒，不然开奖太快没意思 */
  const drop = async () => {
    if (!challenge || !canSubmit(challenge.passRule, answers)) return;
    const startedAt = performance.now();
    const payload = [slotPayload(answers[0]), slotPayload(answers[1])] as [FamiliarSlotAnswer, FamiliarSlotAnswer];
    setNote(null);
    setMood('closed');
    setSay('我听听看……');
    setScene({ name: 'needle', state: 'spin' });
    const settle = (run: () => void) => later(Math.max(0, SPIN_MS - (performance.now() - startedAt)), run);
    try {
      const r = await submitAnswers(challenge.challengeId, payload);
      if (r.passed) {
        settle(() => {
          setMood('happy');
          setSay('……这声音。');
          setScene({ name: 'needle', state: 'pass' });
          later(PASS_MS, () => {
            setSay('是你啊。');
            setScene({ name: 'open', fresh: true });
          });
        });
        return;
      }
      settle(() => {
        const next = { ...challenge, attemptsRemaining: r.attemptsRemaining, nextChallengeAt: r.nextChallengeAt };
        setMood('squint');
        setScene({ name: 'needle', state: 'fail' });
        if (r.attemptsRemaining <= 0) {
          setSay('放不出来。');
          setChallenge(next);
          later(FAIL_MS, () => {
            setMood('asleep');
            setSay('今天先这样吧。');
            setScene({ name: 'spent', recalled: false });
          });
          return;
        }
        setSay(failLine(r.attemptsRemaining, challenge));
        needleBack(next);
      });
    } catch (e) {
      const err = e as ApiError;
      settle(() => void afterFailure(err));
    }
  };

  /** 提交没拿到明确结果：先问资格，绝不自动重交（重交可能多扣一次） */
  const afterFailure = async (err: ApiError) => {
    if (err.code === 5920) return void enter();
    if (err.status === 429 || err.code === 5910) {
      setMood('squint');
      setSay('慢点，慢点。');
      setNote(err.message);
      setScene({ name: 'quiz' });
      return;
    }
    try {
      const s = await fetchFamiliar();
      if (s.verified) {
        setMood('happy');
        setSay('是你啊。');
        setScene({ name: 'open', fresh: true });
        return;
      }
      if (err.code === 5921) {
        if (hasLiveChallenge(s)) showChallenge(await openChallenge());
        else void enter();
        return;
      }
      const c = hasLiveChallenge(s) ? await openChallenge() : null;
      if (!c) return void enter();
      setChallenge(c);
      if (c.available && c.attemptsRemaining > 0) {
        setMood('idle');
        setSay('刚才信号断了一下，也不知道听没听到。');
        setNote(`还能落针 ${c.attemptsRemaining} 次，看好再落。`);
        setScene({ name: 'quiz' });
      } else showChallenge(c);
    } catch {
      setMood('squint');
      setSay('刚才信号断了一下。');
      setNote(err.message);
      setScene({ name: 'quiz' });
    }
  };

  const opening = scene.name === 'open' && scene.fresh;
  return (
    <div ref={root} tabIndex={-1} className="fq" role="dialog" aria-modal="true" aria-label="对暗号" data-scene={scene.name} data-opening={opening || undefined}>
      <div className="fq-leaf left" aria-hidden="true" />
      <div className="fq-leaf right" aria-hidden="true" />
      <button type="button" className="fq-leave" onClick={onClose}>
        离开
      </button>
      <div className="fq-scroll">
        <div className="fq-stage">
          {scene.name !== 'open' && (
            <div className="fq-host">
              <Hatch mood={mood} />
              <Say text={say} />
            </div>
          )}
          {scene.name === 'door' && (
            <>
              <Crate periods={status?.periodOptions ?? []} canRandom={!!status?.canUseRandom} busy={busy} onPick={(id) => void pick(id)} onSkip={onClose} />
              {note && <p className="fq-note">{note}</p>}
            </>
          )}
          {scene.name === 'quiz' && challenge && (
            <Quiz challenge={challenge} answers={answers} setAnswer={setAnswer} side={side} flip={flip} flipping={flipping} note={note} onDrop={() => void drop()} />
          )}
          {scene.name === 'needle' && <Deck state={scene.state} />}
          {scene.name === 'open' && <Opened period={challenge?.period?.label} verifiedAt={status?.verifiedAt} fresh={scene.fresh} onClose={onClose} />}
          {scene.name === 'spent' && <Spent until={challenge?.nextChallengeAt ?? status?.nextChallengeAt ?? ''} recalled={scene.recalled} onRetry={() => void enter()} onClose={onClose} />}
          {scene.name === 'paused' && (
            <div className="fq-spent">
              <button className="btn solid" onClick={onClose}>
                好，先回去
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 申请页上的入口 ----------------

/** 入口：资格和会员是两回事，不管有没有排队、是不是会员都能对暗号；验证没开放时整块不出现 */
export function FamiliarEntry() {
  const userId = useStore(authStore, (s) => s.user?.id);
  const status = useStore(familiarStore, (s) => (s.userId === userId ? s.status : null));
  const [open, setOpen] = useState(false);
  const layer = useRef(0);

  useEffect(() => {
    if (!userId) return;
    // 旧后端没有这个接口、或者查询失败：不打扰，正常申请不受影响
    void fetchFamiliar().catch(() => undefined);
  }, [userId]);

  useEffect(() => () => dropLayer(layer.current), []);

  const show = () => {
    setOpen(true);
    layer.current = pushLayer(() => setOpen(false));
  };
  const hide = () => popLayer(layer.current);

  if (!status) return null;
  const needsEmail = status.reason === 'email_verification_required';
  if (!status.verified && !status.canVerify && !needsEmail) return null;
  const live = hasLiveChallenge(status);

  return (
    <>
      {status.verified ? (
        <div className="fq-entry verified">
          <Hatch mood="happy" small />
          <span className="fq-entry-text">
            <b>熟客</b>
            <small className="mono">{shortDate(status.verifiedAt)} 对上暗号</small>
          </span>
          <button className="text-btn" onClick={show}>
            看看熟客卡
          </button>
        </div>
      ) : (
        <div className="fq-entry">
          <Hatch mood={needsEmail ? 'asleep' : 'idle'} small />
          <span className="fq-entry-text">
            <b>认识我？对个暗号</b>
            <small>{needsEmail ? '确认邮箱之后就能来敲门。' : live ? '上次那张单曲还在，接着答就行。' : '两个只有老朋友才答得上的小问题。不答也能正常申请。'}</small>
          </span>
          <button className="btn sm" onClick={show} disabled={needsEmail}>
            {live ? '接着答' : '敲门'}
          </button>
        </div>
      )}
      {open && createPortal(<Quest onClose={hide} />, document.body)}
    </>
  );
}
