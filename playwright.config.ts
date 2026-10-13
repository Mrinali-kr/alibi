import { defineConfig, devices } from '@playwright/test';

const runDir = process.env.ALIBI_RUN_DIR ?? '.runs/local';

export default defineConfig({
  testDir: `${runDir}/tests`,
  timeout: 120_000,
  retries: 1,
  outputDir: `${runDir}/output`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${runDir}/report.json` }],
    ['html', { outputFolder: `${runDir}/html`, open: 'never' }],
  ],
  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
