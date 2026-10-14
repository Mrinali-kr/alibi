import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from './paths.ts';

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

export const ACTIVE: RunStatus[] = ['running', 'writing_report'];
export const FINISHED: RunStatus[] = [
  'passed', 'passed_with_warnings', 'flaky', 'failed', 'couldnt_run', 'timed_out', 'cancelled', 'interrupted',
];

export type RunParams = {
  env: string;
  url?: string;
  repo: string;
  branch: string;
  test: string;
  /** Device ids from config/devices.json, tested one after another. */
  devices?: string[] | undefined;
  /** Older runs: 'desktop' or 'mobile'. */
  device?: string | undefined;
  note?: string;
  localPath?: string;
};

export type RunSummary = {
  label?: string | undefined;
  teamResponsible?: 'BE' | 'FE' | null | undefined;
  service?: string | undefined;
  cause?: string | undefined;
  pdf?: string | undefined;
  durationMs?: number | undefined;
  warnings: string[];
  error?: string | undefined;
  annotations?: { type: string; description?: string }[];
};

export type Run = {
  id: number;
  status: RunStatus;
  params: RunParams;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: RunSummary | null;
};

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(resolve(DATA_DIR, 'alibi.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    params TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    summary TEXT
  )
`);

type Row = {
  id: number;
  status: RunStatus;
  params: string;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  summary: string | null;
};

const toRun = (r: Row): Run => ({
  id: r.id,
  status: r.status,
  params: JSON.parse(r.params),
  requestedBy: r.requested_by,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  summary: r.summary ? JSON.parse(r.summary) : null,
});

const now = () => new Date().toISOString();

/** A run cut off by a restart can't be resumed; mark it so the next one can start. */
export function markInterrupted() {
  const placeholders = ACTIVE.map(() => '?').join(',');
  db.prepare(`UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status IN (${placeholders})`).run(now(), ...ACTIVE);
}

export function createRun(params: RunParams, requestedBy: string): Run {
  const res = db
    .prepare(`INSERT INTO runs (status, params, requested_by, created_at) VALUES ('queued', ?, ?, ?)`)
    .run(JSON.stringify(params), requestedBy, now());
  return getRun(Number(res.lastInsertRowid))!;
}

export function getRun(id: number): Run | undefined {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
  return row && toRun(row);
}

export function listRuns(limit = 50): Run[] {
  return (db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(toRun);
}

export function queuedRuns(): Run[] {
  return (db.prepare(`SELECT * FROM runs WHERE status = 'queued' ORDER BY id`).all() as Row[]).map(toRun);
}

export function setStatus(id: number, status: RunStatus) {
  if (status === 'running') {
    db.prepare('UPDATE runs SET status = ?, started_at = ? WHERE id = ?').run(status, now(), id);
  } else if (FINISHED.includes(status)) {
    db.prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?').run(status, now(), id);
  } else {
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, id);
  }
}

export function setSummary(id: number, summary: RunSummary) {
  db.prepare('UPDATE runs SET summary = ? WHERE id = ?').run(JSON.stringify(summary), id);
}
