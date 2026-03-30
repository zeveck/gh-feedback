import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  use: {
    baseURL: 'http://localhost:3456',
  },
  webServer: {
    command: 'npx serve -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: true,
  },
});
