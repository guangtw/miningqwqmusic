import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.PLAYWRIGHT_PORT || 3010);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error("Invalid Playwright port");
const production = process.env.PLAYWRIGHT_PRODUCTION === '1';
const workers = Number(process.env.PLAYWRIGHT_WORKERS || 2);
if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('Invalid Playwright workers');

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["record-store.spec.ts", "site-shell.spec.ts", "session-recovery.spec.ts", "familiar.spec.ts", "email-password.spec.ts"],
  workers,
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${testPort}`,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm run ${production ? 'start' : 'dev'} -- --hostname 127.0.0.1 --port ${testPort}`,
    url: process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${testPort}`,
    reuseExistingServer: !process.env.PLAYWRIGHT_ISOLATED
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] }
    }
  ]
});
