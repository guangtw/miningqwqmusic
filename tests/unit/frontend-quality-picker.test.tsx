import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { QualityPicker } from '@/src/frontend/components/QualityPicker';

afterEach(cleanup);

it.each(['sky', 'lossless'] as const)('uses the reported %s fallback on the selected Dolby card', actualLevel => {
  render(<QualityPicker value="dolby" onPick={() => {}} available={['exhigh', 'sky']} fallback={{ dolby: 'sky' }} actualLevel={actualLevel} />);
  const selected = screen.getByRole('radio', { name: /杜比全景声/ });
  expect(selected).toHaveAttribute('aria-checked', 'true');
  expect(selected).toHaveTextContent(actualLevel === 'sky' ? '本曲按「沉浸环绕声」' : '本曲按「无损」');
});

it('does not advertise a catalog fallback when the selected tier is explicitly reported by the source', () => {
  render(<QualityPicker value="dolby" onPick={() => {}} available={['exhigh', 'sky']} fallback={{ dolby: 'sky' }} actualLevel="dolby" />);
  expect(screen.getByRole('radio', { name: /杜比全景声/ })).not.toHaveTextContent('本曲按');
});
