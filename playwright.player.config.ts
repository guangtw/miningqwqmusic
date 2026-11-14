import { defineConfig, devices } from '@playwright/test';

// 播放器网络时序用例单独一套：只跑桌面 Chromium、串行，跑生产构建（CI 先 build 再跑），避免开发服务器首编译拖慢计时
const testPort = Number(process.env.PLAYWRIGHT_PORT || 3011);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid Playwright port');
const production = process.env.PLAYWRIGHT_PRODUCTION === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['player-network.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npm run ${production ? 'start' : 'dev'} -- --hostname 127.0.0.1 --port ${testPort}`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
});
