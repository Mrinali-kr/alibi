import { useEffect, useState, type ReactNode } from 'react';
import { api, FINISHED, loadReport, reportPdf, type DeviceSection, type Report, type Run, type StepRow } from './api.ts';
import { Icon, LiveLog, ago, durationOf, fmtDuration, lookOf, statusWord } from './ui.tsx';

const file = (id: number, rel?: string) => (rel ? `/reports/${id}/${rel}` : undefined);

const STEP_LOOK: Record<StepRow['status'], { icon: string; tone: string }> = {
  passed: { icon: 'check_circle', tone: 'text-tertiary' },
  failed: { icon: 'error', tone: 'text-error' },
  skipped: { icon: 'redo', tone: 'text-outline' },
  'not reached': { icon: 'radio_button_unchecked', tone: 'text-outline' },
};

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-surface-container-low border border-outline-variant border-t-2 border-t-primary/30 rounded-lg p-5">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-outline-variant gap-3">
        <h2 className="text-[18px] font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function List({ items, empty = 'None' }: { items: ReactNode[]; empty?: string }) {
  if (!items.length) return <p className="font-mono text-[11px] text-outline">{empty}</p>;
  return <ul className="space-y-1.5 font-mono text-[11px]">{items.map((x, i) => <li key={i} className="break-words">{x}</li>)}</ul>;
}

function DeviceView({ id, d }: { id: number; d: DeviceSection }) {
  const f = d.failure;
  const phone = /android|iphone|mobile/i.test(d.device);
  return (
    <div className="space-y-6">
      <Card title="Steps" right={<span className="font-mono text-[11px] text-outline">{fmtDuration(d.durationMs)}</span>}>
        <div className="rounded-lg border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant/60">
          {d.steps.map((s) => {
            const look = STEP_LOOK[s.status];
            return (
              <div key={s.index} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
                <span className="font-mono text-[11px] text-outline w-5">{s.index}</span>
                <Icon name={look.icon} className={`text-[16px] ${look.tone}`} />
                <span className={`flex-1 ${s.status === 'not reached' || s.status === 'skipped' ? 'text-on-surface-variant' : ''}`}>
                  {s.name}
                  {s.reason && <span className="font-mono text-[11px] text-outline"> · {s.reason}</span>}
                </span>
                <span className={`font-mono text-[11px] ${look.tone}`}>{s.status}</span>
                <span className="font-mono text-[11px] text-outline w-14 text-right">{(s.durationMs / 1000).toFixed(1)} s</span>
              </div>
            );
          })}
        </div>
      </Card>

      {f && (
        <Card title="What went wrong" right={<span className="font-mono text-[11px] text-error">{f.step}</span>}>
          <div className="space-y-4">
            <pre className="whitespace-pre-wrap break-words bg-surface-container-lowest border border-error/40 rounded-lg p-3 font-mono text-[11px] text-on-surface">{f.error}</pre>
            {f.earlierAttempt && <p className="font-mono text-[11px] text-outline">First attempt: {f.earlierAttempt}</p>}
            <div>
              <h3 className="text-[12px] font-medium text-on-surface-variant mb-2">Failed network calls (this step and the one before)</h3>
              <List
                items={f.failedRequests.map((c) => (
                  <>
                    <span className="text-error">{c.status ?? c.error ?? 'no response'}</span> {c.method} {c.url}
                    {c.body && <pre className="mt-1 whitespace-pre-wrap text-outline max-h-40 overflow-auto custom-scrollbar">{c.body}</pre>}
                  </>
                ))}
              />
            </div>
            <div>
              <h3 className="text-[12px] font-medium text-on-surface-variant mb-2">Page errors</h3>
              <List items={f.pageErrors.map((e) => e.message)} />
            </div>
            <div>
              <h3 className="text-[12px] font-medium text-on-surface-variant mb-2">Console errors</h3>
              <List items={f.consoleErrors.map((e) => (
                <>
                  {e.text} {e.location && <span className="text-outline">{e.location}</span>}
                </>
              ))} />
            </div>
          </div>
        </Card>
      )}

      {(d.warnings.length > 0 || d.notes.length > 0) && (
        <Card title="Warnings & notes">
          <div className="space-y-3">
            <List items={d.warnings.map((w) => <span className="text-warn">{w}</span>)} empty="No warnings" />
            {d.notes.length > 0 && <List items={d.notes.map((n) => <><span className="text-outline">{n.type}:</span> {n.description}</>)} />}
          </div>
        </Card>
      )}

      <Card
        title="Screenshots"
        right={
          <div className="flex gap-3 font-mono text-[11px]">
            {d.files.video && <a className="text-primary hover:underline" href={file(id, d.files.video)} target="_blank" rel="noreferrer">Video</a>}
            {d.files.trace && <a className="text-outline hover:text-on-surface" href={file(id, d.files.trace)} title="Open with: npx playwright show-trace">Trace</a>}
          </div>
        }
      >
        <div className={`grid gap-4 ${phone ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {d.steps.filter((s) => s.screenshot).map((s) => (
            <a key={s.index} href={file(id, s.screenshot)} target="_blank" rel="noreferrer" className="group block">
              <div className="font-mono text-[11px] mb-1.5 truncate">
                <span className="text-outline">{s.index}.</span> {s.name} <span className={STEP_LOOK[s.status].tone}>({s.status})</span>
              </div>
              <img src={file(id, s.screenshot)} alt={s.name} loading="lazy" className="w-full rounded-lg border border-outline-variant group-hover:border-primary" />
            </a>
          ))}
        </div>
        {!d.steps.some((s) => s.screenshot) && <p className="font-mono text-[11px] text-outline">No screenshots.</p>}
      </Card>
    </div>
  );
}

export function RunDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  const [report, setReport] = useState<Report | null>(null);
  const [tab, setTab] = useState(0);
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);
  const finished = run ? FINISHED.includes(run.status) : false;

  useEffect(() => {
    setRun(undefined);
    setReport(null);
    setTab(0);
    setMessage(null);
    let stop = false;
    const load = () => api.run(id).then((r) => !stop && setRun(r), () => !stop && setRun(null));
    load();
    const t = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (finished) loadReport(id).then(setReport, () => setReport(null));
  }, [id, finished]);

  if (run === undefined) return <p className="px-8 py-8 font-mono text-[11px] text-outline">Loading run #{id}…</p>;
  if (run === null) return <p className="px-8 py-8 font-mono text-[11px] text-error">There is no run #{id}.</p>;

  const look = lookOf(run);
  const result = report?.result;
  const device = report?.devices[tab];
  const devices = report?.run.devices ?? run.params.devices ?? [run.params.device ?? 'desktop'];

  const rerun = () =>
    api.rerun(run.id).then(
      ({ run: next }) => {
        onChanged();
        location.hash = `#/runs/${next.id}`;
      },
      (err: Error) => setMessage({ tone: 'text-error', text: err.message }),
    );
  const cancel = () => api.cancel(run.id).then(onChanged, (err: Error) => setMessage({ tone: 'text-error', text: err.message }));

  const details: [string, ReactNode][] = [
    ['Tested on', report?.run.target ?? run.params.url ?? run.params.env],
    ['Backend', report?.run.backend ?? 'shown when the report is ready'],
    ['Tests from', report?.run.testsFrom ?? (run.params.localPath ? `local folder ${run.params.localPath}` : `${run.params.repo} @ ${run.params.branch}`)],
    ['Devices', devices.join(', ')],
    ['Run by', run.requestedBy],
    ['Started', run.startedAt ? `${new Date(run.startedAt).toLocaleString()} (${ago(run.startedAt)})` : 'not yet'],
    ['Duration', fmtDuration(durationOf(run)) || '…'],
  ];
  if (run.params.note) details.push(['Note', run.params.note]);

  return (
    <>
      <div className="border-b border-outline-variant bg-surface-dim/80 px-8 py-6">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5 min-w-0">
            <a href="#/runs" className="font-mono text-[11px] text-outline hover:text-on-surface flex items-center gap-1">
              <Icon name="arrow_back" className="text-[14px]" />All runs
            </a>
            <div className="flex items-center gap-3">
              <h1 className="text-[24px] leading-8 font-semibold tracking-tight">Run #{run.id}</h1>
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container border border-outline-variant font-mono text-[10px] font-semibold ${look.tone}`}>
                <Icon name={look.icon} className={`text-[14px] ${look.spin ? 'animate-spin' : ''}`} />
                {statusWord(run)}
              </span>
            </div>
            <p className="text-on-surface-variant">
              {run.params.test} · {devices.join(', ')}
            </p>
            {message && <p className={`font-mono text-[11px] ${message.tone}`}>{message.text}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!finished && (
              <button type="button" onClick={cancel} className="px-3 py-2 rounded-lg border border-outline-variant text-[12px] text-on-surface-variant hover:border-error hover:text-error">
                Cancel
              </button>
            )}
            {finished && report && (
              <a href={reportPdf(run.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant text-[12px] hover:border-outline">
                <Icon name="picture_as_pdf" className="text-[16px]" />PDF
              </a>
            )}
            {finished && (
              <button type="button" onClick={rerun} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:brightness-95">
                <Icon name="replay" className="text-[16px]" />Run again
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-6">
            {result && (
              <section
                className={`rounded-lg p-5 border ${
                  result.teamResponsible || result.status === 'failed' ? 'border-error/50 bg-error/[0.06]' : result.status === 'flaky' ? 'border-warn/50 bg-warn/[0.06]' : 'border-outline-variant bg-surface-container-low'
                }`}
              >
                <div className={`text-[18px] font-semibold ${look.tone}`}>
                  {result.label}
                  {result.service && <span className="font-mono text-[13px] font-normal"> · {result.service}{result.endpoint ? ` · ${result.endpoint}` : ''}</span>}
                </div>
                <p className="mt-1">{result.cause}</p>
                <p className="mt-2 font-mono text-[11px] text-outline">Component: {result.component}</p>
              </section>
            )}

            {report && report.devices.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {report.devices.map((d, i) => {
                  const ok = ['passed', 'passed_with_warnings'].includes(d.result.status);
                  return (
                    <button
                      key={d.device}
                      type="button"
                      onClick={() => setTab(i)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] ${
                        tab === i ? 'bg-primary/[0.08] border-primary' : 'bg-surface-container-low border-outline-variant hover:border-outline'
                      }`}
                    >
                      <Icon name={/android|iphone/.test(d.device) ? 'smartphone' : 'computer'} className="text-[16px] text-outline" />
                      <span className="font-medium">{d.label}</span>
                      <span className={`font-mono text-[10px] ${ok ? 'text-tertiary' : d.result.status === 'flaky' ? 'text-warn' : 'text-error'}`}>
                        {d.result.status.replace(/_/g, ' ')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {device && <DeviceView id={run.id} d={device} />}
            {!report && finished && (
              <p className="font-mono text-[11px] text-outline">
                No report for this run{run.summary?.error ? `: ${run.summary.error}` : '.'} The log on the right shows what happened.
              </p>
            )}
            {!finished && <p className="font-mono text-[11px] text-outline">Steps and screenshots show here when the run finishes. Follow it live on the right.</p>}
          </div>

          <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-20">
            <section className="bg-surface-container-low border border-outline-variant rounded-lg p-5">
              <h2 className="text-[18px] font-semibold pb-3 mb-3 border-b border-outline-variant">Details</h2>
              <dl className="space-y-2.5 text-[12px]">
                {details.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-on-surface-variant text-[11px]">{k}</dt>
                    <dd className="font-mono text-[11px] break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <LiveLog run={run} onCancel={cancel} />
          </div>
        </div>
      </div>
    </>
  );
}
