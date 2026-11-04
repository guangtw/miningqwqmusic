// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import catalog from '@/src/lib/client-downloads/catalog.json';
import { GET as list } from '@/app/api/downloads/route';
import { GET as download, HEAD } from '@/app/api/downloads/[platform]/route';

const require = createRequire(import.meta.url);
const { validatedAssets, nginxLocation } = require('../../ops/scripts/install-client-downloads.cjs');
const call = (platform: string, query = '') => download(new Request(`https://echo.example.test/api/downloads/${platform}${query}`), {
  params: Promise.resolve({ platform }),
});

describe('public client downloads', () => {
  it('publishes both platforms, exact release hashes/sizes and only same-origin links', async () => {
    const response = list();
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.code).toBe(0);
    expect(body.data.platforms.map((entry: { platform: string }) => entry.platform)).toEqual(['windows', 'android']);
    for (const platform of body.data.platforms) {
      for (const asset of platform.artifacts) {
        expect(asset.url).toBe('/downloads/clients/' + asset.fileName);
        expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(asset.size).toBeGreaterThan(0);
      }
    }
  });

  it('provides only the Windows installer / Android APK', async () => {
    for (const [platform, query, suffix] of [
      ['windows', '', '-Setup.exe'], ['windows', '?variant=installer', '-Setup.exe'], ['android', '', '.apk'],
    ]) {
      const response = await call(platform, query);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toMatch(new RegExp(suffix.replaceAll('.', '\\.') + '$'));
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const head = await HEAD(new Request('https://example.test/api/downloads/windows', { method: 'HEAD' }), {
      params: Promise.resolve({ platform: 'windows' }),
    });
    expect(head.status).toBe(307);
    expect(await head.text()).toBe('');
  });

  it('rejects unsupported platforms/variants and does not allow an external redirect or file path', async () => {
    for (const [platform, query] of [
      ['macos', ''], ['../windows', ''], ['windows', '?variant=../private'],
      ['windows', '?variant=https://evil.example/'], ['android', '?variant=portable'], ['windows', '?variant=portable'], ['windows', '?variant='],
    ]) expect((await call(platform, query)).status).toBe(404);
    const response = await call('windows', '?url=https://evil.example/&filename=../private');
    expect(response.headers.get('location')).toBe('/downloads/clients/' + catalog.platforms[0].artifacts[0].fileName);
  });

  it('keeps Nginx locations restricted to checksum-pinned versioned binaries', () => {
    const assets = validatedAssets(catalog);
    expect(assets).toHaveLength(2);
    const config = nginxLocation(assets[0]);
    expect(config).toContain('location = /downloads/clients/');
    expect(config).toContain('shared/client-downloads/');
    expect(config).toContain('attachment; filename=');
    expect(config).not.toContain('proxy_pass');
    for (const override of [{ fileName: '../.env' }, { sha256: 'x' }, { size: -1 }, { contentType: 'text/html;' }]) {
      const changed = structuredClone(catalog);
      Object.assign(changed.platforms[0].artifacts[0], override);
      expect(() => validatedAssets(changed)).toThrow();
    }
    const duplicate = structuredClone(catalog);
    duplicate.platforms[0].artifacts.push(duplicate.platforms[0].artifacts[0]);
    expect(() => validatedAssets(duplicate)).toThrow();
  });
});
