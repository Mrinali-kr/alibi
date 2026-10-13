import { getRun, queuedRuns, setStatus } from './db.ts';
import { executeRun, stopCurrent } from './runner.ts';
import { endLog } from './logs.ts';

let runningId: number | null = null;

/** Starts the next queued run if nothing is running. One run at a time across Alibi. */
export function kick() {
  if (runningId !== null) return;
  const next = queuedRuns()[0];
  if (!next) return;
  runningId = next.id;
  executeRun(next)
    .catch((err) => console.error(`Run #${next.id} crashed:`, err))
    .finally(() => {
      runningId = null;
      kick();
    });
}

export function queueState() {
  return { current: runningId, waiting: queuedRuns().map((r) => r.id) };
}

/** How many runs are ahead of this one: 0 means it is running or starts next. */
export function runsAhead(id: number) {
  if (runningId === id) return 0;
  const i = queuedRuns().map((r) => r.id).indexOf(id);
  return i === -1 ? null : i + (runningId !== null ? 1 : 0);
}

export function cancel(id: number): boolean {
  const run = getRun(id);
  if (!run) return false;
  if (run.status === 'queued') {
    setStatus(id, 'cancelled');
    endLog(id);
    return true;
  }
  return stopCurrent(id);
}
