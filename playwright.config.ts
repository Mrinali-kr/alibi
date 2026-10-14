import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// One project per device in config/devices.json; Alibi picks them with --project.
const deviceList: Record<string, { playwright: string }> = JSON.parse(readFileSync(join(__dirname, 'config/devices.json'), 'utf8'));

const runDir = process.env.ALIBI_RUN_DIR ?? '.runs/local';

export default defineConfig({
  testDir: `${runDir}/tests`,
  timeout: 120_000,
  retries: 1,
  outputDir: `${runDir}/output`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${runDir}/playwright-report.json` }],
    ['html', { outputFolder: `${runDir}/html`, open: 'never' }],
  ],
  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: Object.entries(deviceList).map(([name, d]) => ({ name, use: { ...devices[d.playwright] } })),
});
