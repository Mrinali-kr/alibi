// Runs an FE repo's /alibi tests from this repo, the same way the server will:
// copy the tests in, then run Playwright here.
// Usage: npm run test:local -- <path to FE repo>/alibi [--device desktop-chrome|desktop-safari|android|iphone] [--url <base url>]
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const testsSource = args.find((a) => !a.startsWith('--') && !isValueOf(a));
const oldNames = { desktop: 'desktop-chrome', mobile: 'android' };
const given = valueOf('--device') ?? 'desktop-chrome';
const device = oldNames[given] ?? given;
const url = valueOf('--url');

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
function isValueOf(a) {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1].startsWith('--');
}

if (!testsSource || !existsSync(resolve(testsSource, 'manifest.json'))) {
  console.error('Give the path to an /alibi folder that has a manifest.json, e.g.');
  console.error('  npm run test:local -- ../bond-scanner/alibi --device android');
  process.exit(1);
}

const runDir = '.runs/local';
rmSync(runDir, { recursive: true, force: true });
cpSync(resolve(testsSource), resolve(runDir, 'tests'), { recursive: true });

const pwArgs = ['playwright', 'test'];
pwArgs.push('--project', device);

const result = spawnSync('npx', pwArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ALIBI_RUN_DIR: runDir, ...(url ? { ALIBI_BASE_URL: url } : {}) },
});
console.log(`\nReport: ${runDir}/html/index.html  (open with: npx playwright show-report ${runDir}/html)`);
process.exit(result.status ?? 1);
