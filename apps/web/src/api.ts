// Calls to the runner server. Types mirror apps/server/src/db.ts.

export type RunStatus =
  | 'queued'
  | 'running'
  | 'writing_report'
  | 'passed'
  | 'passed_with_warnings'
  | 'flaky'
  | 'failed'
  | 'couldnt_run'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted';

export type RunParams = {
  env: string;
  url?: string | undefined;
  repo: string;
  branch: string;
  test: string;
  devices?: string[] | undefined;
  device?: string | undefined;
  note?: string | undefined;
  localPath?: string | undefined;
};

export type Run = {
  id: number;
  status: RunStatus;
  params: RunParams;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: {
    label?: string;
    teamResponsible?: 'BE' | 'FE' | null;
    service?: string;
    cause?: string;
    durationMs?: number;
    warnings: string[];
    error?: string;
  } | null;
};

export type ManifestTest = { id: string; title: string; file: string; devices?: string[] };
export type Environment = { name: string; baseUrl: string; apiBaseUrl?: string };
export type Device = { id: string; label: string; kind: 'desktop' | 'mobile' };
export type QueueState = { current: number | null; waiting: number[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? body.message ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  devices: () => call<Device[]>('/devices'),
  environments: () => call<Environment[]>('/environments'),
  tests: (localPath: string) => call<ManifestTest[]>(`/tests?localPath=${encodeURIComponent(localPath)}`),
  runs: (limit = 5) => call<Run[]>(`/runs?limit=${limit}`),
  run: (id: number) => call<Run>(`/runs/${id}`),
  queue: () => call<QueueState>('/queue'),
  start: (params: Partial<RunParams>) =>
    call<{ run: Run; runsAhead: number | null }>('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),
  rerun: (id: number) => call<{ run: Run; runsAhead: number | null }>(`/runs/${id}/rerun`, { method: "POST" }),
  cancel: (id: number) => call<{ ok: boolean }>(`/runs/${id}/cancel`, { method: 'POST' }),
};

export const FINISHED: RunStatus[] = [
  'passed', 'passed_with_warnings', 'flaky', 'failed', 'couldnt_run', 'timed_out', 'cancelled', 'interrupted',
];
export const reportPdf = (id: number) => `/reports/${id}/report.pdf`;

// ---------- report.json (written by apps/server/src/report.ts) ----------
export type StepRow = { index: number; name: string; status: 'passed' | 'failed' | 'skipped' | 'not reached'; reason?: string; durationMs: number; screenshot?: string };
export type ReportResult = { status: RunStatus; teamResponsible: 'BE' | 'FE' | null; label: string; cause: string; service?: string; endpoint?: string; component: string };
export type DeviceSection = {
  device: string;
  label: string;
  durationMs: number;
  result: ReportResult;
  steps: StepRow[];
  failure?: {
    step: string;
    error: string;
    stack?: string;
    failedRequests: { step: string; method: string; url: string; status: number | null; error?: string; body?: string }[];
    consoleErrors: { step: string; text: string; location?: string }[];
    pageErrors: { step: string; message: string; stack?: string }[];
    earlierAttempt?: string;
  };
  warnings: string[];
  notes: { type: string; description?: string }[];
  files: { trace?: string; video?: string };
};
export type Report = {
  run: { target: string; backend?: string; testsFrom: string; devices: string[]; durationMs: number };
  result: ReportResult;
  devices: DeviceSection[];
  warnings: string[];
};

/** report.json for a run, or null while it runs or if it never got one. Older one-device reports are reshaped. */
export async function loadReport(id: number): Promise<Report | null> {
  const res = await fetch(`/reports/${id}/report.json`);
  if (!res.ok) return null;
  const r = await res.json();
  if (r.schemaVersion === 2) return r as Report;
  const section: DeviceSection = {
    device: r.run.device,
    label: r.run.device,
    durationMs: r.run.durationMs,
    result: r.result,
    steps: r.steps,
    failure: r.failure,
    warnings: r.warnings,
    notes: r.notes,
    files: r.files,
  };
  return { run: { ...r.run, devices: [r.run.device] }, result: r.result, devices: [section], warnings: r.warnings };
}
