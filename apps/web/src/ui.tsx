import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FINISHED, reportPdf, type Run } from './api.ts';

export const REPO = 'bond-scanner';
export const DEFAULT_LOCAL_PATH = 'C:\\Users\\Vavu\\bond-scanner\\alibi';

export function remembered(key: string, fallback: string) {
  try {
    return localStorage.getItem(`alibi.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
export function remember(key: string, value: string) {
  try {
    localStorage.setItem(`alibi.${key}`, value);
  } catch {
    // Private window; nothing to keep.
  }
}

export function usePoll<T>(load: () => Promise<T>, ms: number): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const refresh = useCallback(() => {
    load().then(setData, () => {});
  }, [load]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [refresh, ms]);
  return [data, refresh];
}

export const Icon = ({ name, className = '', fill = false }: { name: string; className?: string; fill?: boolean }) => (
  <span className={`material-symbols-outlined ${fill ? 'icon-fill' : ''} ${className}`}>{name}</span>
);

export function durationOf(run: Run) {
  if (run.summary?.durationMs) return run.summary.durationMs;
  if (run.startedAt && run.finishedAt) return Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return null;
}
export function fmtDuration(ms: number | null) {
  if (ms === null) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
export function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 60 / 24)}d ago`;
}

export type Look = { icon: string; tone: string; text: string; spin?: boolean };

export function lookOf(run: Run): Look {
  const ds = run.params.devices ?? [run.params.device ?? 'desktop'];
  const who = `${run.params.test} · ${ds.length > 1 ? `${ds.length} devices` : ds[0]} · ${run.requestedBy}`;
  const s = run.summary;
  switch (run.status) {
    case 'passed':
      return { icon: 'check_circle', tone: 'text-tertiary', text: who };
    case 'passed_with_warnings':
      return { icon: 'check_circle', tone: 'text-tertiary', text: `Passed · ${s?.warnings.length ?? 0} warnings` };
    case 'flaky':
      return { icon: 'warning', tone: 'text-warn', text: 'Flaky · passed on retry' };
    case 'failed':
      return {
        icon: 'error',
        tone: 'text-error',
        text: s?.teamResponsible
          ? `Team responsible: ${s.teamResponsible}${s.service ? ` (${s.service})` : ''}`
          : 'Failed · needs triage',
      };
    case 'couldnt_run':
      return { icon: 'cloud_off', tone: 'text-outline', text: "Couldn't run · environment" };
    case 'timed_out':
      return { icon: 'timer_off', tone: 'text-error', text: 'Timed out · 30 min' };
    case 'cancelled':
      return { icon: 'block', tone: 'text-outline', text: 'Cancelled' };
    case 'interrupted':
      return { icon: 'power_off', tone: 'text-outline', text: 'Interrupted · server restarted' };
    case 'queued':
      return { icon: 'schedule', tone: 'text-outline', text: `Queued · ${who}` };
    case 'running':
      return { icon: 'progress_activity', tone: 'text-primary', text: `Running · ${who}`, spin: true };
    case 'writing_report':
      return { icon: 'progress_activity', tone: 'text-primary', text: 'Writing report', spin: true };
  }
}

export const statusWord = (run: Run) => run.status.replace(/_/g, ' ').toUpperCase();

// ---------- Layout pieces ----------

export function SectionHead({ n, title, sub, right }: { n: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-3 mb-4 border-b border-outline-variant gap-3">
      <div className="flex items-center space-x-3">
        <div className="w-6 h-6 rounded bg-primary flex items-center justify-center font-mono text-[11px] text-on-primary font-bold">
          {n}
        </div>
        <div>
          <h2 className="text-[18px] font-semibold">{title}</h2>
          {sub && <p className="text-[12px] text-on-surface-variant">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Toggle<T extends string>({
  value,
  options,
  onChange,
  bg = 'bg-surface-container-lowest',
}: {
  value: T;
  options: { value: T; label: string; icon?: string; disabled?: string }[];
  onChange: (v: T) => void;
  bg?: string;
}) {
  return (
    <div className={`flex items-center p-0.5 rounded-lg border border-outline-variant ${bg} font-mono text-[11px] w-fit`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.disabled}
          disabled={!!o.disabled}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded flex items-center gap-1 ${
            value === o.value ? 'bg-surface-container-high text-primary' : 'text-outline hover:text-on-surface'
          } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-outline`}
        >
          {o.icon && <Icon name={o.icon} className="text-[14px]" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function host(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

// ---------- Right column ----------

export function lineClass(line: string) {
  if (/✓|Result: passed/.test(line)) return 'text-tertiary';
  if (/✘|✗|Result: (failed|timed_out)|Error/.test(line)) return 'text-error';
  if (/flaky|warning|Result: (couldnt_run|cancelled)/i.test(line)) return 'text-warn';
  if (/^Run #\d+:/.test(line)) return 'text-secondary';
  return '';
}

export function LiveLog({ run, onCancel }: { run: Run | null; onCancel: (id: number) => void }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const id = run?.id;

  useEffect(() => {
    setText('');
    if (id === undefined) return;
    const es = new EventSource(`/runs/${id}/log`);
    es.onmessage = (e) => setText((t) => t + JSON.parse(e.data));
    es.addEventListener('end', () => es.close());
    es.onerror = () => es.close();
    return () => es.close();
  }, [id]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [text]);

  const lines = text.split('\n').filter((l, i, all) => l.trim() || (i > 0 && all[i - 1]?.trim()));
  const live = run && !FINISHED.includes(run.status);

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-4">
      <div className="flex items-center justify-between pb-2 border-b border-outline-variant/60 mb-2">
        <div className="flex items-center space-x-2">
          <Icon name="terminal" className="text-[16px] text-tertiary" />
          <span className="font-mono text-[11px] font-semibold">Live log{run ? ` · run #${run.id}` : ''}</span>
        </div>
        <div className="flex items-center gap-3">
          {live && (
            <button type="button" onClick={() => onCancel(run.id)} className="font-mono text-[10px] text-outline hover:text-error">
              CANCEL
            </button>
          )}
          {run && <span className={`font-mono text-[10px] ${live ? 'text-primary' : lookOf(run).tone}`}>{statusWord(run)}</span>}
        </div>
      </div>
      <div ref={box} className="font-mono text-[11px] leading-5 text-on-surface-variant/80 max-h-80 overflow-y-auto custom-scrollbar">
        {!run && <p className="text-outline">No runs yet. Start one and its log shows here.</p>}
        {run && lines.length === 0 && <p className="text-outline italic">{run.status === 'queued' ? 'Waiting for its turn…' : 'Starting…'}</p>}
        {lines.map((l, i) => (
          <p key={i} className={`whitespace-pre-wrap break-words ${lineClass(l)}`}>
            {l || '\u00a0'}
          </p>
        ))}
        {live && lines.length > 0 && <p className="text-primary italic">→ running…</p>}
      </div>
      {run && FINISHED.includes(run.status) && run.status !== 'cancelled' && (
        <div className="flex gap-3 pt-2 mt-2 border-t border-outline-variant/60 font-mono text-[11px]">
          <a className="text-primary hover:underline" href={reportPdf(run.id)} target="_blank" rel="noreferrer">
            PDF report
          </a>
          <a className="text-outline hover:text-on-surface" href={`/reports/${run.id}/report.json`} target="_blank" rel="noreferrer">
            JSON
          </a>
          <a className="text-outline hover:text-on-surface" href={`/reports/${run.id}/html/index.html`} target="_blank" rel="noreferrer">
            Playwright report
          </a>
        </div>
      )}
    </div>
  );
}

export type Route = { page: 'new' } | { page: 'runs'; q: string } | { page: 'run'; id: number };

/** Pages live after the # so they never clash with the server's /runs API. */
export function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/runs\/(\d+)/);
  if (m) return { page: 'run', id: Number(m[1]) };
  if (hash.startsWith('#/runs')) return { page: 'runs', q: decodeURIComponent(hash.split('?q=')[1] ?? '') };
  return { page: 'new' };
}
