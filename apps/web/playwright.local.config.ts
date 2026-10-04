import { defineConfig, devices } from '@playwright/test';

/** E2E for the GitHub Pages (local mode) build: `npm run build:pages` + `vite preview`. */
export default defineConfig({
  testDir: './e2e-local',
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_LOCAL_URL ?? 'http://localhost:4173/vitalog/', locale: 'bg-BG' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
});
