import {describe, it, expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error Plain Node operator utility.
import {packHandoff, unpackHandoff} from '../../ops/scripts/handoff-bundle.mjs';

describe('private handoff package', () => {
  it('round-trips UTF-8 files with authenticated encryption, refuses overwrite and keeps keys outside the checkout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-handoff-'));
    try {
      const input = path.join(root, 'input.json'), key = path.join(root, 'handoff.key'), bundle = path.join(root, 'encrypted.json');
      const text = JSON.stringify({prompt: '合成测试题', answer: 'SYNTHETIC_PRIVATE_ANSWER'});
      fs.writeFileSync(input, text);
      packHandoff({files: [input], keyFile: key, output: bundle});
      expect(fs.readFileSync(bundle, 'utf8')).not.toContain('SYNTHETIC_PRIVATE_ANSWER');
      const output = path.join(root, 'decoded');
      expect(unpackHandoff({bundleFile: bundle, keyFile: key, outputDirectory: output})).toMatchObject({verified: true});
      expect(fs.readFileSync(path.join(output, 'input.json'), 'utf8')).toBe(text);
      expect(() => unpackHandoff({bundleFile: bundle, keyFile: key, outputDirectory: output})).toThrow('ALREADY_EXISTS');
      expect(() => unpackHandoff({bundleFile: bundle, keyFile: key, outputDirectory: path.join(process.cwd(), 'docs', 'private')})).toThrow('OUTSIDE_REPOSITORY');
      expect(() => packHandoff({files: [input], keyFile: path.join(process.cwd(), 'private.key'), output: bundle})).toThrow('OUTSIDE_REPOSITORY');
    } finally {fs.rmSync(root, {recursive: true, force: true});}
  });
  it('rejects wrong keys and modified ciphertext before writing any decoded files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-handoff-'));
    try {
      const input = path.join(root, 'input.txt'), key = path.join(root, 'handoff.key'), bundle = path.join(root, 'encrypted.json');
      fs.writeFileSync(input, 'synthetic fixture only');
      packHandoff({files: [input], keyFile: key, output: bundle});
      const wrong = path.join(root, 'wrong.key'); fs.writeFileSync(wrong, 'ff'.repeat(32));
      const output = path.join(root, 'decoded');
      expect(() => unpackHandoff({bundleFile: bundle, keyFile: wrong, outputDirectory: output})).toThrow();
      expect(fs.existsSync(output)).toBe(false);
      const value = JSON.parse(fs.readFileSync(bundle, 'utf8'));
      value.ciphertext = (value.ciphertext[0] === 'A' ? 'B' : 'A') + value.ciphertext.slice(1);
      fs.writeFileSync(bundle, JSON.stringify(value));
      expect(() => unpackHandoff({bundleFile: bundle, keyFile: key, outputDirectory: output})).toThrow();
      expect(fs.existsSync(output)).toBe(false);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
  });
});
