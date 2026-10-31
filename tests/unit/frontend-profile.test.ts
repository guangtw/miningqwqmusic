import { describe, expect, it } from 'vitest';
import { avatarProblem, passwordProblem } from '@/src/frontend/lib/profile';

describe('account profile rules', () => {
  it('matches the account service password policy', () => {
    expect(passwordProblem('Abcdefg1!x')).toBeNull();
    expect(passwordProblem('abcDEF12')).toBe('密码还需要：10 位以上、符号。');
    expect(passwordProblem(`Aa1!${'x'.repeat(130)}`)).toBe('密码最多 128 位。');
  });

  it('rejects avatar types the account service cannot store', () => {
    expect(avatarProblem(new File(['x'], 'a.bmp', { type: 'image/bmp' }))).toBe('只支持 PNG、JPG、WebP、GIF 图片。');
    expect(avatarProblem(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull();
  });
});
