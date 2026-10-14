import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, runDir } from './paths.ts';
import { fetchTests } from './sources.ts';
import { endLog, writeLog } from './logs.ts';
import { getRun, setStatus, setSummary, type Run, type RunStatus, type RunSummary } from './db.ts';
import { buildReport } from './report.ts';

const MAX_RUN_MS = 30 * 60 * 1000;

let current: { id: number; child: ChildProcess; stopReason?: 'cancelled' | 'timed_out' } | null = null;

export const currentRunId = () => current?.id ?? null;

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** Stops the run that is executing now. Returns false if it isn't the current run. */
export function stopCurrent(id: number): boolean {
  if (!current || current.id !== id) return false;
  current.stopReason = 'cancelled';
  killTree(current.child);
  return true;
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

type PwResult = { status: string; duration: number; error?: { message?: string }; errors?: { message?: string }[] };
type PwTest = { annotations?: { type: string; description?: string }[]; results: PwResult[] };
type PwSuite = { suites?: PwSuite[]; specs?: { tests: PwTest[] }[] };
type PwReport = {
  stats?: { expected: number; unexpected: number; flaky: number; duration: number };
  errors?: { message?: string }[];
  suites?: PwSuite[];
};

function allTests(suites: PwSuite[] = []): PwTest[] {
  return suites.flatMap((s) => [...(s.specs ?? []).flatMap((sp) => sp.tests), ...allTests(s.suites)]);
}

/** Turns Playwright's JSON report into Alibi's result and summary. */
export function readResult(dir: string): { status: RunStatus; summary: RunSummary } {
  const file = resolve(dir, 'playwright-report.json');
  if (!existsSync(file)) {
    return { status: 'couldnt_run', summary: { warnings: [], error: 'Playwright produced no report' } };
  }
  const report: PwReport = JSON.parse(readFileSync(file, 'utf8'));
  const tests = allTests(report.suites);
  const annotations = tests.flatMap((t) => t.annotations ?? []);
  const warnings = [...new Set(annotations.filter((a) => a.type === 'warning').map((a) => a.description ?? ''))];
  const stats = report.stats ?? { expected: 0, unexpected: 0, flaky: 0, duration: 0 };
  const firstError = tests
    .flatMap((t) => t.results)
    .map((r) => r.error?.message ?? r.errors?.[0]?.message)
    .find(Boolean);
  const summary: RunSummary = {
    durationMs: Math.round(stats.duration),
    warnings,
    annotations: annotations.filter((a) => a.type !== 'warning'),
  };

  if (stats.expected + stats.unexpected + stats.flaky === 0) {
    return { status: 'couldnt_run', summary: { ...summary, error: stripAnsi(report.errors?.[0]?.message ?? 'No test ran') } };
  }
  if (stats.unexpected > 0) return { status: 'failed', summary: { ...summary, error: firstError && stripAnsi(firstError) } };
  if (stats.flaky > 0) return { status: 'flaky', summary: { ...summary, error: firstError && stripAnsi(firstError) } };
  return { status: warnings.length ? 'passed_with_warnings' : 'passed', summary };
}

export async function executeRun(run: Run) {
  const { id, params } = run;
  const dir = runDir(id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  setStatus(id, 'running');
  writeLog(id, `Run #${id}: ${params.test} on ${params.url ?? params.env} (${params.device}), ${params.repo}@${params.branch}\n`);

  const finish = (status: RunStatus, summary: RunSummary) => {
    setSummary(id, summary);
    setStatus(id, status);
    writeLog(id, `\nResult: ${status}\n`);
    endLog(id);
  };

  let file: string;
  try {
    await fetchTests(params, resolve(dir, 'tests'));
    const manifest = JSON.parse(readFileSync(resolve(dir, 'tests/manifest.json'), 'utf8'));
    const entry = manifest.tests.find((t: { id: string }) => t.id === params.test);
    if (!entry) throw new Error(`Test "${params.test}" is not in the manifest`);
    file = entry.file;
  } catch (err) {
    return finish('couldnt_run', { warnings: [], error: (err as Error).message });
  }

  const args = ['playwright', 'test', file, '--project', params.device];
  // Windows needs a shell to find npx; pass one command string there so Node doesn't warn about unescaped args.
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? `npx ${args.map((a) => `"${a}"`).join(' ')}` : 'npx', isWin ? [] : args, {
    cwd: ROOT,
    shell: isWin,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ALIBI_RUN_DIR: dir,
      ALIBI_ENV: params.env,
      ...(params.url ? { ALIBI_BASE_URL: params.url } : {}),
      FORCE_COLOR: '0',
    },
  });
  current = { id, child };
  child.stdout?.on('data', (d) => writeLog(id, d.toString()));
  child.stderr?.on('data', (d) => writeLog(id, d.toString()));

  const timer = setTimeout(() => {
    if (current?.id === id) current.stopReason = 'timed_out';
    killTree(child);
  }, MAX_RUN_MS);

  await new Promise<void>((done) => child.on('close', () => done()));
  clearTimeout(timer);
  const stopReason = current?.stopReason;
  current = null;

  if (stopReason) {
    return finish(stopReason, {
      warnings: [],
      error: stopReason === 'timed_out' ? 'Stopped after 30 minutes' : 'Cancelled',
    });
  }
  setStatus(id, 'writing_report');
  let { status, summary } = readResult(dir);
  try {
    const report = await buildReport(getRun(id) ?? run, dir);
    if (report) {
      status = report.result.status;
      summary = {
        ...summary,
        label: report.result.label,
        teamResponsible: report.result.teamResponsible,
        service: report.result.service,
        cause: report.result.cause,
        pdf: `/reports/${id}/report.pdf`,
      };
    }
  } catch (err) {
    writeLog(id, `\nCould not build the report: ${(err as Error).message}\n`);
  }
  finish(status, summary);
}
