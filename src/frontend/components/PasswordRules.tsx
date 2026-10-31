import { passwordRules } from '../lib/profile';

/** 新密码下面的一排小标签：满足一条亮一条 */
export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="pw-rules" aria-label="密码要求">
      {passwordRules.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.key} className={ok ? 'ok' : ''} aria-label={`${r.label}${ok ? '，已满足' : ''}`}>
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}
