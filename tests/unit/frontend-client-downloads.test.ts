import { describe, expect, it } from 'vitest';
import { compareVersions, detectVisitor, formatBytes, orderFor, releaseDate, shortHash, type ClientPlatform } from '@/src/frontend/lib/clientDownloads';

const ua = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

describe('client downloads (frontend)', () => {
  it('recommends the platform this device can install, and recognises the two client shells', () => {
    expect(detectVisitor(ua.windows, {})).toEqual({ platform: 'windows', apple: false, inClient: null });
    expect(detectVisitor(ua.android, {})).toEqual({ platform: 'android', apple: false, inClient: null });
    expect(detectVisitor(ua.iphone, {})).toMatchObject({ platform: null, apple: true });
    expect(detectVisitor(ua.mac, {})).toMatchObject({ platform: null, apple: true });
    expect(detectVisitor(ua.linux, {})).toMatchObject({ platform: null, apple: false });
    // Windows 壳是 WebView2：认 chrome.webview，不靠 UA
    expect(detectVisitor(ua.windows, { chrome: { webview: {} } })).toMatchObject({ platform: 'windows', inClient: 'windows' });
    expect(detectVisitor(`${ua.android} MiningQwQMusicAndroid/1.0.3`, {})).toEqual({ platform: 'android', apple: false, inClient: 'android', clientVersion: '1.0.3' });
  });

  it('compares versions numerically and puts the recommended platform first', () => {
    expect(compareVersions('1.0.3', '1.0.10')).toBe(-1);
    expect(compareVersions('1.1', '1.0.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    const list = [{ platform: 'windows' }, { platform: 'android' }] as ClientPlatform[];
    expect(orderFor(list, 'android').map((p) => p.platform)).toEqual(['android', 'windows']);
    expect(orderFor(list, null)).toBe(list);
  });

  it('formats sizes, dates and fingerprints the way the page shows them', () => {
    expect(formatBytes(88154103)).toBe('84.1 MB');
    expect(formatBytes(1028139)).toBe('1.0 MB');
    expect(formatBytes(655360)).toBe('640 KB');
    expect(formatBytes(0)).toBe('');
    expect(releaseDate('not a date')).toBe('');
    expect(releaseDate('2026-11-01T13:30:25Z')).toMatch(/^2026\.11\.0[12]$/);
    expect(shortHash('4f17b68163dba7b7aefbd0f89b70afbb832ac98bf4f764c3554a107587dbd92b')).toBe('4f17b681…87dbd92b');
  });
});
