const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  workers: 1,
  outputDir: 'evidence/test-results',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'evidence/html-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.N8N_BASE_URL,
    headless: true,
    viewport: { width: 1600, height: 1000 },
    video: 'on',
    trace: 'on',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
