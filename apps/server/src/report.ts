import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { Run, RunStatus } from './db.ts';
import { ROOT } from './paths.ts';

// ---------- Playwright JSON report (only the parts we read) ----------
type PwError = { message?: string; stack?: string };
type PwStep = { title: string; duration: number; error?: PwError; steps?: PwStep[] };
type PwAttachment = { name: string; contentType: string; path?: string };
type PwResult = {
  status: string;
  duration: number;
  error?: PwError;
  errors?: PwError[];
  steps?: PwStep[];
  attachments?: PwAttachment[];
};
type PwTest = { annotations?: { type: string; description?: string }[]; results: PwResult[]; status: string };
type PwSpec = { title: string; tests: PwTest[] };
type PwSuite = { suites?: PwSuite[]; specs?: PwSpec[] };
type PwReport = {
  stats?: { expected: number; unexpected: number; flaky: number; duration: number };
  errors?: PwError[];
  suites?: PwSuite[];
};

type Captured = {
  consoleErrors: { step: string; text: string; location?: string }[];
  pageErrors: { step: string; message: string; stack?: string }[];
  failedRequests: { step: string; method: string; url: string; status: number | null; error?: string; body?: string }[];
};

// ---------- Alibi report (schema v1) ----------
export type TeamResponsible = 'BE' | 'FE' | null;

export type AlibiReport = {
  schemaVersion: 1;
  run: {
    id: number;
    requestedBy: string;
    test: string;
    target: string;
    env: string;
    backend?: string | undefined;
    testsFrom: string;
    device: string;
    note?: string | undefined;
    startedAt: string | null;
    finishedAt: string;
    durationMs: number;
  };
  result: {
    status: RunStatus;
    teamResponsible: TeamResponsible;
    label: string;
    cause: string;
    service?: string | undefined;
    endpoint?: string | undefined;
    component: string;
  };
  steps: { index: number; name: string; status: 'passed' | 'failed' | 'skipped' | 'not reached'; reason?: string | undefined; durationMs: number; screenshot?: string | undefined }[];
  failure?: undefined | {
    step: string;
    error: string;
    stack?: string | undefined;
    failedRequests: Captured['failedRequests'];
    consoleErrors: Captured['consoleErrors'];
    pageErrors: Captured['pageErrors'];
    earlierAttempt?: string | undefined;
  };
  warnings: string[];
  notes: { type: string; description?: string }[];
  files: { trace?: string | undefined; video?: string | undefined; html: string; pdf: string };
};

const stripAnsi = (s = '') => s.replace(/\u001b\[[0-9;]*m/g, '');
const firstLine = (s = '') => stripAnsi(s).split('\n').find((l) => l.trim())?.trim() ?? '';

function allTests(suites: PwSuite[] = []): PwTest[] {
  return suites.flatMap((s) => [...(s.specs ?? []).flatMap((sp) => sp.tests), ...allTests(s.suites)]);
}

/** e.g. https://s1-cognito.one.phoenix.sustvest.in/api/x -> "cognito" */
export function serviceFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (/^[\d.]+$|^\[|^localhost$/.test(host)) return host;
    const first = host.split('.')[0];
    return (first ?? host).replace(/^s\d+-/, '');
  } catch {
    return url;
  }
}

const isEnvironmentError = (msg: string) =>
  /net::ERR_|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|page\.goto: (Timeout|net::)|NS_ERROR/i.test(msg);

/**
 * Decides team responsible from the evidence around the failure. `scope` is the failing step and the
 * one before it: an action (e.g. pressing Enter) often fails in the step that waits for its result.
 */
export function attribute(failStep: string, scope: string[], error: string, cap: Captured, isFirstStep: boolean) {
  const inStep = <T extends { step: string }>(xs: T[]) => xs.filter((x) => scope.includes(x.step));
  const calls = inStep(cap.failedRequests);
  const pageErrors = inStep(cap.pageErrors);
  const consoleErrors = inStep(cap.consoleErrors);

  if (isEnvironmentError(error) && (isFirstStep || /page\.goto/.test(error))) {
    return {
      status: 'couldnt_run' as RunStatus,
      team: null,
      label: "Couldn't run - environment",
      cause: `The site did not load: ${firstLine(error)}`,
    };
  }
  const apiCall = calls.find((c) => c.status === null || c.status >= 400);
  if (apiCall) {
    const service = serviceFromUrl(apiCall.url);
    const what = apiCall.status === null ? `failed (${apiCall.error ?? 'no response'})` : `returned ${apiCall.status}`;
    return {
      status: 'failed' as RunStatus,
      team: 'BE' as const,
      service,
      endpoint: `${apiCall.method} ${new URL(apiCall.url).pathname}`,
      label: 'team responsible - BE',
      cause: `${apiCall.method} ${new URL(apiCall.url).pathname} on ${service} ${what} during "${apiCall.step}"`,
    };
  }
  if (pageErrors.length || consoleErrors.length) {
    const ev = pageErrors[0] ?? consoleErrors[0];
    const msg = pageErrors[0]?.message ?? consoleErrors[0]?.text;
    return {
      status: 'failed' as RunStatus,
      team: 'FE' as const,
      label: 'team responsible - FE',
      cause: `The page threw an error during "${ev?.step ?? failStep}": ${firstLine(msg)}`,
    };
  }
  if (/expect\(|locator\.|toBe|toHave|waiting for/i.test(error)) {
    return {
      status: 'failed' as RunStatus,
      team: 'FE' as const,
      label: 'team responsible - FE',
      cause: `All API calls were fine, but the page did not show what was expected during "${failStep}": ${firstLine(error)}`,
    };
  }
  return {
    status: 'failed' as RunStatus,
    team: null,
    label: 'Needs triage',
    cause: `"${failStep}" failed: ${firstLine(error)}`,
  };
}

/** The API base URL the environment profile records, so each report says which backend was used. */
function profileOf(env: string): { baseUrl?: string; apiBaseUrl?: string } {
  try {
    const profiles = JSON.parse(readFileSync(resolve(ROOT, 'config/environments.json'), 'utf8'));
    return profiles[env] ?? {};
  } catch {
    return {};
  }
}

const toRel = (dir: string, p?: string) => (p ? relative(dir, p).split('\\').join('/') : undefined);

/** Builds report.json and report.pdf for a finished run. Returns the final status. */
export async function buildReport(run: Run, dir: string): Promise<AlibiReport | null> {
  const pwFile = resolve(dir, 'playwright-report.json');
  if (!existsSync(pwFile)) return null;
  const pw: PwReport = JSON.parse(readFileSync(pwFile, 'utf8'));
  const test = allTests(pw.suites)[0];
  if (!test) return null;

  const results = test.results;
  const last = results.at(-1);
  if (!last) return null;
  const attachments = last.attachments ?? [];
  const capFile = attachments.find((a) => a.name === 'alibi-capture')?.path;
  const cap: Captured =
    capFile && existsSync(capFile)
      ? JSON.parse(readFileSync(capFile, 'utf8'))
      : { consoleErrors: [], pageErrors: [], failedRequests: [] };

  // Only Alibi's named steps (not Playwright's own hooks).
  const named = (last.steps ?? []).filter((s) => !/^(Before Hooks|After Hooks|Worker Cleanup)$/.test(s.title));
  const shots = attachments.filter((a) => /^step-\d+: /.test(a.name));
  const skipped = new Map(
    (test.annotations ?? [])
      .filter((a) => a.type === 'skipped-step' && a.description)
      .map((a) => {
        const d = a.description ?? '';
        const at = d.indexOf(': ');
        return [d.slice(0, at), d.slice(at + 2)] as const;
      }),
  );
  const steps: AlibiReport['steps'] = named.map((s, i) => ({
    index: i + 1,
    name: s.title,
    status: s.error ? 'failed' : skipped.has(s.title) ? 'skipped' : 'passed',
    reason: s.error ? undefined : skipped.get(s.title),
    durationMs: Math.round(s.duration),
    screenshot: toRel(dir, shots.find((a) => a.name.startsWith(`step-${i + 1}: `))?.path),
  }));

  const annotations = test.annotations ?? [];
  const warnings = [...new Set(annotations.filter((a) => a.type === 'warning').map((a) => a.description ?? ''))];
  const notes = annotations.filter((a) => a.type !== 'warning' && a.type !== 'skipped-step');
  const passed = last.status === 'passed';
  const flaky = passed && results.length > 1;

  let result: AlibiReport['result'];
  let failure: AlibiReport['failure'];
  const component = 'not available yet (source maps pending)';

  if (passed) {
    result = {
      status: flaky ? 'flaky' : warnings.length ? 'passed_with_warnings' : 'passed',
      teamResponsible: null,
      label: flaky ? 'Flaky' : 'Passed',
      cause: flaky
        ? `Failed first, passed on retry: ${firstLine(results[0]?.error?.message)}`
        : warnings.length
          ? `Passed with ${warnings.length} warning(s)`
          : 'All steps passed',
      component,
    };
  } else {
    const failIdx = named.findIndex((s) => s.error);
    const failStep = named[failIdx]?.title ?? '(before first step)';
    const error = stripAnsi(last.error?.message ?? last.errors?.[0]?.message ?? 'Unknown error');
    const scope = [named[failIdx - 1]?.title ?? '(before first step)', failStep];
    const a = attribute(failStep, scope, error, cap, failIdx <= 0);
    result = {
      status: a.status,
      teamResponsible: a.team,
      label: a.label,
      cause: a.cause,
      service: 'service' in a ? a.service : undefined,
      endpoint: 'endpoint' in a ? a.endpoint : undefined,
      component,
    };
    // Steps after the failing one never ran.
    for (const s of steps) if (failIdx >= 0 && s.index > failIdx + 1) s.status = 'not reached';
    const inStep = <T extends { step: string }>(xs: T[]) => xs.filter((x) => scope.includes(x.step));
    failure = {
      step: failStep,
      error,
      stack: stripAnsi(last.error?.stack ?? ''),
      failedRequests: inStep(cap.failedRequests),
      consoleErrors: inStep(cap.consoleErrors),
      pageErrors: inStep(cap.pageErrors),
      earlierAttempt: results.length > 1 ? firstLine(results[0]?.error?.message) : undefined,
    };
  }

  const p = run.params;
  const report: AlibiReport = {
    schemaVersion: 1,
    run: {
      id: run.id,
      requestedBy: run.requestedBy,
      test: p.test,
      target: p.url ?? `${p.env} (${profileOf(p.env).baseUrl ?? 'no URL in config'})`,
      env: p.env,
      backend: profileOf(p.env).apiBaseUrl,
      testsFrom: p.localPath ? `local folder ${p.localPath}` : `${p.repo} @ ${p.branch}`,
      device: p.device,
      note: p.note,
      startedAt: run.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(results.reduce((t, r) => t + r.duration, 0)),
    },
    result,
    steps,
    failure,
    warnings,
    notes,
    files: {
      trace: toRel(dir, attachments.find((a) => a.name === 'trace')?.path),
      video: toRel(dir, attachments.find((a) => a.name === 'video')?.path),
      html: 'html/index.html',
      pdf: 'report.pdf',
    },
  };

  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2));
  await writePdf(report, dir);
  return report;
}

// ---------- PDF ----------
const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function img(dir: string, rel?: string) {
  if (!rel) return '';
  const file = resolve(dir, rel);
  if (!existsSync(file)) return '';
  return `<img src="data:image/png;base64,${readFileSync(file).toString('base64')}">`;
}

function html(r: AlibiReport, dir: string) {
  const ok = ['passed', 'passed_with_warnings'].includes(r.result.status);
  const color = ok ? '#1a7f37' : r.result.status === 'flaky' ? '#9a6700' : '#cf222e';
  const f = r.failure;
  const rows = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="muted">None</p>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:12px/1.45 -apple-system,Segoe UI,Arial,sans-serif;color:#1f2328;margin:28px}
    h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #d0d7de;padding-bottom:4px}
    .status{display:inline-block;padding:3px 10px;border-radius:12px;color:#fff;background:${color};font-weight:600}
    .label{font-size:15px;font-weight:600;margin:10px 0 2px} .muted{color:#656d76}
    table{border-collapse:collapse;width:100%} td,th{border:1px solid #d0d7de;padding:4px 6px;text-align:left;vertical-align:top}
    pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;padding:8px;border-radius:6px;font-size:10.5px}
    .step{page-break-inside:avoid;margin-bottom:12px} .step img{width:100%;border:1px solid #d0d7de;border-radius:4px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  </style></head><body>
    <h1>Alibi run #${r.run.id}: ${esc(r.run.test)}</h1>
    <span class="status">${esc(r.result.status.replace(/_/g, ' '))}</span>
    <div class="label">${esc(r.result.label)}${r.result.service ? ` (${esc(r.result.service)}${r.result.endpoint ? `: ${esc(r.result.endpoint)}` : ''})` : ''}</div>
    <p>${esc(r.result.cause)}</p>
    <table>
      <tr><th>Tested on</th><td>${esc(r.run.target)}</td><th>Device</th><td>${esc(r.run.device)}</td></tr>
      <tr><th>Backend</th><td colspan="3">${esc(r.run.backend ?? 'not recorded')}</td></tr>
      <tr><th>Tests from</th><td>${esc(r.run.testsFrom)}</td><th>Run by</th><td>${esc(r.run.requestedBy)}</td></tr>
      <tr><th>Started</th><td>${esc(r.run.startedAt ?? '')}</td><th>Duration</th><td>${(r.run.durationMs / 1000).toFixed(1)} s</td></tr>
      <tr><th>Component</th><td colspan="3">${esc(r.result.component)}</td></tr>
      ${r.run.note ? `<tr><th>Note</th><td colspan="3">${esc(r.run.note)}</td></tr>` : ''}
    </table>

    <h2>Steps</h2>
    <table><tr><th>#</th><th>Step</th><th>Result</th><th>Time</th></tr>
      ${r.steps.map((s) => `<tr><td>${s.index}</td><td>${esc(s.name)}</td><td${s.status === 'skipped' ? ' class="muted"' : ''}>${s.status}${s.reason ? ` (${esc(s.reason)})` : ''}</td><td>${(s.durationMs / 1000).toFixed(1)} s</td></tr>`).join('')}
    </table>

    ${f ? `<h2>Failure</h2>
      <p><b>Step:</b> ${esc(f.step)}</p>
      <pre>${esc(f.error)}</pre>
      ${f.earlierAttempt ? `<p class="muted">First attempt: ${esc(f.earlierAttempt)}</p>` : ''}
      <p><b>Failed network calls (this step and the one before)</b></p>
      ${rows(f.failedRequests.map((c) => `${esc(c.method)} ${esc(c.url)} → <b>${c.status ?? esc(c.error ?? 'no response')}</b>${c.body ? `<pre>${esc(c.body)}</pre>` : ''}`))}
      <p><b>Page errors</b></p>
      ${rows(f.pageErrors.map((e) => `${esc(e.message)}${e.stack ? `<pre>${esc(e.stack)}</pre>` : ''}`))}
      <p><b>Console errors</b></p>
      ${rows(f.consoleErrors.map((e) => `${esc(e.text)}${e.location ? ` <span class="muted">${esc(e.location)}</span>` : ''}`))}` : ''}

    <h2>Warnings</h2>
    ${rows(r.warnings.map(esc))}

    ${r.notes.length ? `<h2>Notes</h2>${rows(r.notes.map((n) => `${esc(n.type)}: ${esc(n.description ?? '')}`))}` : ''}

    <h2>Screenshots</h2>
    <div class="grid">
      ${r.steps.filter((s) => s.screenshot).map((s) => `<div class="step"><b>${s.index}. ${esc(s.name)}</b> <span class="muted">(${s.status})</span>${img(dir, s.screenshot)}</div>`).join('')}
    </div>
    <p class="muted">Trace, video and the full Playwright report are stored with run #${r.run.id}.</p>
  </body></html>`;
}

async function writePdf(r: AlibiReport, dir: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html(r, dir), { waitUntil: 'load' });
    await page.pdf({ path: resolve(dir, 'report.pdf'), format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  } finally {
    await browser.close();
  }
}
