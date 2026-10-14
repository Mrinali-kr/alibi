import { useMemo, useState } from 'react';
import type { Run, RunStatus } from './api.ts';
import { Icon, ago, durationOf, fmtDuration, lookOf } from './ui.tsx';

const FILTERS: { key: string; label: string; statuses: RunStatus[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  { key: 'live', label: 'Running & queued', statuses: ['running', 'writing_report', 'queued'] },
  { key: 'passed', label: 'Passed', statuses: ['passed', 'passed_with_warnings'] },
  { key: 'failed', label: 'Failed', statuses: ['failed', 'timed_out'] },
  { key: 'flaky', label: 'Flaky', statuses: ['flaky'] },
  { key: 'couldnt', label: "Couldn't run", statuses: ['couldnt_run', 'cancelled', 'interrupted'] },
];

const SHORT: Record<string, string> = {
  'desktop-chrome': 'Desktop Chrome', 'desktop-safari': 'Desktop Safari', android: 'Android', iphone: 'iPhone', desktop: 'Desktop', mobile: 'Mobile',
};
const devicesText = (r: Run) => (r.params.devices ?? [r.params.device ?? 'desktop']).map((d) => SHORT[d] ?? d).join(', ');
const targetText = (r: Run) => r.params.url ?? r.params.env;

/** Matches "#12" or "12" to a run number, anything else to test, devices, target, note, person and result. */
function matches(r: Run, q: string) {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const n = t.replace(/^#/, '');
  if (/^\d+$/.test(n)) return String(r.id) === n;
  const look = lookOf(r);
  return [r.params.test, devicesText(r), targetText(r), r.params.note ?? '', r.requestedBy, look.text, r.status.replace(/_/g, ' ')]
    .join(' ')
    .toLowerCase()
    .includes(t);
}

export function RunsPage({ runs, q, onQuery }: { runs: Run[] | null; q: string; onQuery: (q: string) => void }) {
  const [filter, setFilter] = useState('all');
  const statuses = FILTERS.find((f) => f.key === filter)?.statuses ?? [];
  const shown = useMemo(
    () => (runs ?? []).filter((r) => (!statuses.length || statuses.includes(r.status)) && matches(r, q)),
    [runs, statuses, q],
  );
  const count = (key: string) => {
    const st = FILTERS.find((f) => f.key === key)?.statuses ?? [];
    return (runs ?? []).filter((r) => !st.length || st.includes(r.status)).length;
  };

  return (
    <>
      <div className="border-b border-outline-variant bg-surface-dim/80 px-8 py-6">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-[24px] leading-8 font-semibold tracking-tight">Runs</h1>
            <p className="text-on-surface-variant">Every run, newest first. Open one for its steps, screenshots and report.</p>
          </div>
          <div className="relative w-full lg:w-96">
            <Icon name="filter_list" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]" />
            <input
              value={q}
              onChange={(e) => onQuery(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-9 pr-3 py-2 font-mono text-[11px] text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
              placeholder="Filter by #, test, device, note or URL"
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-6 space-y-4">
        <div className="flex flex-wrap gap-2 font-mono text-[11px]">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-lg border ${
                filter === f.key ? 'bg-primary text-on-primary border-primary font-semibold' : 'border-outline-variant text-on-surface-variant hover:border-outline'
              }`}
            >
              {f.label} <span className="opacity-60">{count(f.key)}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-low">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container font-mono text-[10px] tracking-wider text-outline uppercase">
                <th className="py-2.5 px-4 font-semibold">Run</th>
                <th className="py-2.5 px-4 font-semibold">Result</th>
                <th className="py-2.5 px-4 font-semibold">Test</th>
                <th className="py-2.5 px-4 font-semibold">Devices</th>
                <th className="py-2.5 px-4 font-semibold">Tested on</th>
                <th className="py-2.5 px-4 font-semibold">By</th>
                <th className="py-2.5 px-4 font-semibold text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60 font-mono text-[11px]">
              {runs === null && (
                <tr>
                  <td colSpan={7} className="py-4 px-4 text-outline">Loading…</td>
                </tr>
              )}
              {runs && shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 px-4 text-outline">No runs match.</td>
                </tr>
              )}
              {shown.map((r) => {
                const look = lookOf(r);
                const result = ['passed', 'running', 'queued'].includes(r.status) ? r.status.replace(/_/g, ' ') : look.text;
                return (
                  <tr key={r.id} className="hover:bg-surface-container cursor-pointer" onClick={() => (location.hash = `#/runs/${r.id}`)}>
                    <td className="py-2.5 px-4 font-semibold">
                      <a href={`#/runs/${r.id}`} className="hover:text-primary">#{r.id}</a>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`flex items-center gap-1.5 ${look.tone}`}>
                        <Icon name={look.icon} className={`text-[16px] ${look.spin ? 'animate-spin' : ''}`} />
                        <span className="truncate max-w-[16rem]">{result}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      {r.params.test}
                      {r.params.note && <div className="text-outline truncate max-w-[14rem] font-sans text-[11px]">{r.params.note}</div>}
                    </td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{devicesText(r)}</td>
                    <td className="py-2.5 px-4 text-on-surface-variant truncate max-w-[14rem]">{targetText(r)}</td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{r.requestedBy}</td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div>{fmtDuration(durationOf(r))}</div>
                      <div className="text-outline">{ago(r.createdAt)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="font-mono text-[10px] text-outline">Showing the latest {runs?.length ?? 0} runs.</p>
      </div>
    </>
  );
}
