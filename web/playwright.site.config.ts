import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-site',
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', headless: true },
  webServer: {
    command:
      'npm run build:site && npm run preview:site -- --host 127.0.0.1 --port 4174 --strictPort',
    env: { VITE_GITLAB_HOST: 'gitlab.example.com', VITE_GITLAB_CLIENT_ID: 'test-client' },
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:4174',
  },
})
