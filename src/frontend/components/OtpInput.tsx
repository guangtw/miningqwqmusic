import { useEffect, useRef, useState } from 'react';

/** 某个本机时间点之前还剩几秒，每秒走一次；过了就是 0 */
export function useSecondsLeft(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    setNow(Date.now());
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= until) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/**
 * 验证码输入：一个真的输入框盖在一排格子上。验证码按字符串处理，前导零不会丢；
 * 粘贴整段、手机短信/邮件自动填充都能一次填满。填错时整排晃一下
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  invalid = false,
  disabled = false,
  autoFocus = false,
  label = '验证码',
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 80);
  }, [autoFocus]);
  return (
    <label className={`otp ${invalid ? 'invalid' : ''} ${disabled ? 'disabled' : ''}`} style={{ '--n': length } as React.CSSProperties}>
      <input
        ref={ref}
        className="otp-input mono"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid}
        spellCheck={false}
      />
      <span className="otp-cells mono" aria-hidden="true">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`otp-cell ${i < value.length ? 'filled' : ''} ${i === Math.min(value.length, length - 1) ? 'next' : ''}`}>
            {value[i] ?? ''}
          </span>
        ))}
      </span>
    </label>
  );
}
