import type { FamiliarChallengeView } from '@/src/types/membership';
import { resolveStage, type SideAnswer, type StagePrompt } from '../lib/familiar';
import { Icon } from './Icon';

export type Question = FamiliarChallengeView['questions'][number];

export interface StageProps {
  question: Question;
  spec: StagePrompt;
  answer: SideAnswer | null;
  onAnswer: (a: SideAnswer) => void;
  /** 同一张表单里的单选组名 */
  name: string;
}

const chosen = (a: SideAnswer | null) => (a?.kind === 'choice' ? a.id : '');
const textAt = (a: SideAnswer | null, i: number) => (a?.kind === 'text' ? (a.values[i] ?? '') : '');

/** 单选项都是真的 radio（键盘、读屏都能用），只是外观换成了道具 */
function Radio({ name, id, label, answer, onAnswer }: { name: string; id: string; label: string; answer: SideAnswer | null; onAnswer: StageProps['onAnswer'] }) {
  return <input className="sr-only" type="radio" name={name} value={id} aria-label={label} checked={chosen(answer) === id} onChange={() => onAnswer({ kind: 'choice', id })} />;
}

function Prompt({ spec, className = '' }: { spec: StagePrompt; className?: string }) {
  return <h3 className={`fq-st-prompt ${className}`}>{spec.text}</h3>;
}

function Hint({ spec }: { spec: StagePrompt }) {
  return spec.hint ? <p className="fq-st-hint">{spec.hint}</p> : null;
}

// ---------------- 黑板：用粉笔把答案圈出来 ----------------

const TILT = [-3, 2.2, -1.2, 3, -2.4, 1.4, -1.8, 2.6, -3, 1, -2, 2];
/** 手画的圈：两头不闭合，多绕半圈 */
const CHALK_RING = 'M16 30C12 13 40 5 66 6c26 1 49 9 47 25-2 15-27 23-55 22C30 52 7 44 9 27 11 13 31 6 52 5';

function Chalk({ question, spec, answer, onAnswer, name }: StageProps) {
  return (
    <div className="fq-st st-chalk">
      <div className="fq-chalk-board">
        <div className="fq-chalk-head">
          <span>{spec.kicker || '后黑板'}</span>
          <span aria-hidden="true">值日生：你</span>
        </div>
        <Prompt spec={spec} className="hand" />
        <Hint spec={spec} />
        <div className="fq-chalk-words" role="radiogroup" aria-label={spec.text}>
          {question.options?.map((o, i) => {
            const on = chosen(answer) === o.id;
            return (
              <label key={o.id} className={`fq-chalk-word ${on ? 'on' : ''}`} style={{ '--tilt': `${TILT[i % TILT.length]}deg` } as React.CSSProperties}>
                <Radio name={name} id={o.id} label={o.label} answer={answer} onAnswer={onAnswer} />
                <span className="hand">{o.label}</span>
                {on && (
                  <svg viewBox="0 0 122 60" preserveAspectRatio="none" aria-hidden="true">
                    <path d={CHALK_RING} pathLength={1} />
                  </svg>
                )}
              </label>
            );
          })}
        </div>
        <div className="fq-chalk-tray" aria-hidden="true">
          <i className="fq-chalk-stick" />
          <i className="fq-chalk-stick b" />
          <i className="fq-chalk-eraser" />
        </div>
      </div>
    </div>
  );
}

// ---------------- 田字格：像小时候那样把字写进格子 ----------------

function Roster({ spec, answer, onAnswer }: StageProps) {
  const fields = spec.fields.length ? spec.fields : [''];
  const write = (i: number, v: string) => {
    const values = fields.map((_, j) => (j === i ? v : textAt(answer, j)));
    onAnswer({ kind: 'text', values });
  };
  return (
    <div className="fq-st st-roster">
      <div className="fq-roster-paper">
        <div className="fq-roster-head hand">
          <span>{spec.kicker || '点名册'}</span>
          <span className="fq-roster-tick" aria-hidden="true">
            到
          </span>
        </div>
        <Prompt spec={spec} />
        <div className="fq-roster-cells">
          {fields.map((f, i) => (
            <label key={f || i} className="fq-roster-cell">
              {f && <span className="fq-roster-clue hand">{f}</span>}
              <span className="fq-tian">
                <input
                  value={textAt(answer, i)}
                  onChange={(e) => write(i, e.target.value)}
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={f ? `${f}姓什么` : spec.text}
                  data-long={textAt(answer, i).length > 1 || undefined}
                  className="hand"
                />
              </span>
              <small>{spec.suffix || '姓'}</small>
            </label>
          ))}
        </div>
        <Hint spec={spec} />
      </div>
    </div>
  );
}

// ---------------- 门牌：铜牌上空着一个字 ----------------

function Plaque({ spec, answer, onAnswer }: StageProps) {
  const value = textAt(answer, 0);
  return (
    <div className="fq-st st-plaque">
      <div className="fq-plaque-note">
        <Prompt spec={spec} />
        <Hint spec={spec} />
      </div>
      <div className="fq-plaque-door">
        <div className="fq-plaque-plate">
          <i className="fq-screw a" aria-hidden="true" />
          <i className="fq-screw b" aria-hidden="true" />
          <i className="fq-screw c" aria-hidden="true" />
          <i className="fq-screw d" aria-hidden="true" />
          {spec.kicker && <span className="fq-plaque-kicker">{spec.kicker}</span>}
          <label className="fq-plaque-line">
            <input
              value={value}
              onChange={(e) => onAnswer({ kind: 'text', values: [e.target.value] })}
              maxLength={8}
              autoComplete="off"
              spellCheck={false}
              aria-label={spec.text}
              placeholder="?"
              size={1}
              style={{ '--chars': Math.max(1, value.length) } as React.CSSProperties}
            />
            {spec.suffix && <span>{spec.suffix}</span>}
          </label>
        </div>
        <i className="fq-plaque-handle" aria-hidden="true" />
      </div>
    </div>
  );
}

// ---------------- 翻牌招牌：旧名字划掉，新名字一格一格翻出来 ----------------

function Signboard({ question, spec, answer, onAnswer, name }: StageProps) {
  const options = question.options ?? [];
  const picked = options.find((o) => o.id === chosen(answer));
  const width = Math.max(2, ...options.map((o) => [...o.label].length));
  const cells = Array.from({ length: width }, (_, i) => (picked ? ([...picked.label][i] ?? '') : '?'));
  return (
    <div className="fq-st st-sign">
      <Prompt spec={spec} />
      <Hint spec={spec} />
      <div className="fq-sign-board">
        {spec.was && (
          <span className="fq-sign-was">
            <s>{spec.was}</s>
          </span>
        )}
        <div className="fq-sign-flaps" aria-hidden="true">
          {cells.map((c, i) => (
            <span key={i} className="fq-flap" style={{ '--i': i } as React.CSSProperties}>
              <b key={`${picked?.id ?? 'none'}-${i}`}>{c}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="fq-sign-keys" role="radiogroup" aria-label={spec.text}>
        {options.map((o) => (
          <label key={o.id} className={`fq-sign-key ${chosen(answer) === o.id ? 'on' : ''}`}>
            <Radio name={name} id={o.id} label={o.label} answer={answer} onAnswer={onAnswer} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------- 两栋楼：点一栋，把东西搬到它楼下 ----------------

/** 两栋楼的窗户左右对称，不让外观暗示答案 */
const LIT = [0, 5, 6, 11];

function Dorms({ question, spec, answer, onAnswer, name }: StageProps) {
  return (
    <div className="fq-st st-dorms">
      <Prompt spec={spec} />
      <Hint spec={spec} />
      <div className="fq-dorms-scene" role="radiogroup" aria-label={spec.text}>
        <i className="fq-dorms-moon" aria-hidden="true" />
        {question.options?.map((o, side) => {
          const on = chosen(answer) === o.id;
          return (
            <label key={o.id} className={`fq-dorm ${on ? 'on' : ''}`}>
              <Radio name={name} id={o.id} label={o.label} answer={answer} onAnswer={onAnswer} />
              <span className="fq-dorm-sign">{o.label}</span>
              <span className="fq-dorm-face" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => {
                  // 第二栋把每层左右镜像
                  const at = side ? i - i % 4 + 3 - i % 4 : i;
                  return <i key={i} className={LIT.includes(at) ? 'lit' : ''} style={{ '--i': i } as React.CSSProperties} />;
                })}
              </span>
              <span className="fq-dorm-ground" aria-hidden="true">
                <span className="fq-dorm-door" />
                {on && (
                  <span className="fq-dorm-shop">
                    <i className="fq-awning" />
                    <b>{spec.kicker || '在这儿'}</b>
                    <i className="fq-steam a" />
                    <i className="fq-steam b" />
                    <i className="fq-steam c" />
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- 学生证：在那一栏盖个章 ----------------

function IdCard({ question, spec, answer, onAnswer, name }: StageProps) {
  return (
    <div className="fq-st st-idcard">
      <Prompt spec={spec} />
      <Hint spec={spec} />
      <div className="fq-idcard">
        <div className="fq-idcard-head">
          <span className="fq-idcard-crest" aria-hidden="true" />
          <b>学 生 证</b>
          <small className="mono">STUDENT ID</small>
        </div>
        <div className="fq-idcard-body">
          <div className="fq-idcard-photo" aria-hidden="true">
            <svg viewBox="0 0 60 76">
              <circle cx="30" cy="27" r="13" />
              <path d="M6 76c1-20 11-30 24-30s23 10 24 30z" />
            </svg>
            <i className="fq-idcard-seal" />
          </div>
          <div className="fq-idcard-fields" role="radiogroup" aria-label={spec.text}>
            <span className="fq-idcard-label">{spec.kicker || '专业'}</span>
            {question.options?.map((o) => {
              const on = chosen(answer) === o.id;
              return (
                <label key={o.id} className={`fq-idcard-row ${on ? 'on' : ''}`}>
                  <Radio name={name} id={o.id} label={o.label} answer={answer} onAnswer={onAnswer} />
                  <span>{o.label}</span>
                  {on && (
                    <i className="fq-idcard-stamp" aria-hidden="true">
                      <b className="hand">是它</b>
                    </i>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 群聊：标题栏上的名字被抹掉了 ----------------

/** 聊天内容和题目无关，只是营造气氛 */
const CHATTER: { text: string; mine?: boolean; tone: number }[] = [
  { text: '作业写完的借我看看', tone: 0 },
  { text: '+1', tone: 1 },
  { text: '老师在群里！！', tone: 2 },
  { text: '撤撤撤', mine: true, tone: 0 },
];

function GroupChat({ spec, answer, onAnswer }: StageProps) {
  return (
    <div className="fq-st st-chat">
      <Prompt spec={spec} />
      <Hint spec={spec} />
      <div className="fq-chat-window">
        <div className="fq-chat-bar">
          <i className="fq-chat-back" aria-hidden="true" />
          <input
            value={textAt(answer, 0)}
            onChange={(e) => onAnswer({ kind: 'text', values: [e.target.value] })}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            aria-label={spec.text}
            placeholder="这里本来有个群名"
          />
          <i className="fq-chat-more" aria-hidden="true" />
        </div>
        <div className="fq-chat-log" aria-hidden="true">
          {CHATTER.map((m, i) => (
            <div key={i} className={`fq-chat-line ${m.mine ? 'mine' : ''}`} style={{ '--i': i } as React.CSSProperties}>
              <i className={`fq-chat-avatar t${m.tone}`} />
              <span>{m.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- 默认样式：曲目单和横线本，后台新增的题不写展示形式也好看 ----------------

function Tracklist({ question, spec, answer, onAnswer, name }: StageProps) {
  return (
    <div className="fq-st st-tracks">
      <Prompt spec={spec} />
      <Hint spec={spec} />
      <ol className="fq-tracks" role="radiogroup" aria-label={spec.text}>
        {question.options?.map((o, i) => {
          const on = chosen(answer) === o.id;
          return (
            <li key={o.id}>
              <label className={`fq-track-row ${on ? 'on' : ''}`}>
                <Radio name={name} id={o.id} label={o.label} answer={answer} onAnswer={onAnswer} />
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="fq-track-name">{o.label}</span>
                <i className="fq-track-disc" aria-hidden="true" />
              </label>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Notebook({ spec, answer, onAnswer }: StageProps) {
  const fields = spec.fields.length ? spec.fields : [''];
  return (
    <div className="fq-st st-note">
      <div className="fq-note-paper">
        <Prompt spec={spec} />
        {fields.map((f, i) => (
          <label key={f || i} className="fq-note-line">
            {f && <span className="hand">{f}</span>}
            <input
              className="hand"
              value={textAt(answer, i)}
              onChange={(e) => onAnswer({ kind: 'text', values: fields.map((_, j) => (j === i ? e.target.value : textAt(answer, j))) })}
              maxLength={128}
              autoComplete="off"
              spellCheck={false}
              aria-label={f || spec.text}
            />
            {spec.suffix && <span className="hand">{spec.suffix}</span>}
          </label>
        ))}
        <Hint spec={spec} />
      </div>
    </div>
  );
}

const STAGES = {
  chalk: Chalk,
  roster: Roster,
  plaque: Plaque,
  groupchat: GroupChat,
  signboard: Signboard,
  dorms: Dorms,
  idcard: IdCard,
  tracklist: Tracklist,
  notebook: Notebook,
};

/** 按题目摆出对应的道具。旧题没有 kind 时按填空处理 */
export function QuestionStage(props: StageProps) {
  const kind = props.question.kind ?? 'text';
  const Stage = STAGES[resolveStage(kind, props.spec.stage, props.question.options?.length ?? 0)];
  return <Stage {...props} />;
}

/** 一颗小唱针：还剩多少次机会 */
export function NeedleMark({ on }: { on: boolean }) {
  return (
    <svg className={`fq-needle ${on ? 'on' : ''}`} viewBox="0 0 14 26" aria-hidden="true">
      <path d="M7 1v13" />
      <path d="M3.5 14h7l-1 7h-5z" />
      <path d="M7 21v4" />
    </svg>
  );
}

export function SideDisc({ letter, done, on, onClick }: { letter: string; done: boolean; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`fq-sidedisc ${on ? 'on' : ''} ${done ? 'done' : ''}`} onClick={onClick} aria-current={on ? 'step' : undefined} aria-label={`${letter} 面${done ? '，已作答' : ''}`}>
      <i>{letter}</i>
      {done && (
        <em aria-hidden="true">
          <Icon name="check" size={10} />
        </em>
      )}
    </button>
  );
}
