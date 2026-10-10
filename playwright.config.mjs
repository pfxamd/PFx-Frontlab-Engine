import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 20_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ],
  webServer: [
    {
      command: 'python3 -m http.server 4173 --bind 127.0.0.1',
      url: 'http://127.0.0.1:4173/examples/browser-test.html',
      timeout: 20_000,
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'FRONTLAB_EDITOR_ORIGIN=http://127.0.0.1:4173 node scripts/prepare-preview-host.mjs && node scripts/serve-preview-host.mjs',
      url: 'http://127.0.0.1:4174/runner.html',
      timeout: 20_000,
      reuseExistingServer: !process.env.CI
    }
  ]
});
