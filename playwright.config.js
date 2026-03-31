import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  use: {
    baseURL: 'http://localhost:3456',
  },
  webServer: {
    command: 'npx serve -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: true,
  },
});
