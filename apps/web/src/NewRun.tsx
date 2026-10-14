import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Device, type Environment, type ManifestTest, type QueueState, type Run } from './api.ts';
import {
  DEFAULT_LOCAL_PATH, Icon, LiveLog, REPO, SectionHead, Toggle, cap, durationOf, fmtDuration, host, lookOf, ago, remember, remembered,
} from './ui.tsx';

function RecentRuns({ runs, watching }: { runs: Run[] | null; watching: number | undefined }) {
  return (
    <div className="bg-surface-container-low border border-outline-variant border-t-2 border-t-primary/30 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between border-b border-outline-variant pb-3">
        <div className="flex items-center space-x-2">
          <h3 className="text-[18px] font-semibold">Recent Runs</h3>
          {runs && runs[0] && (
            <span className="px-1.5 py-0.5 rounded-full bg-surface-container text-outline text-[11px] font-mono">{runs[0].id} total</span>
          )}
        </div>
      </div>
      <div className="space-y-2.5 text-[12px]">
        {runs?.length === 0 && <p className="font-mono text-[11px] text-outline">No runs yet.</p>}
        {runs?.map((r) => {
          const look = lookOf(r);
          return (
            <a
              key={r.id}
              href={`#/runs/${r.id}`}
              className={`p-2.5 rounded-lg bg-surface-container-lowest border flex items-center justify-between hover:border-outline cursor-pointer group ${
                r.id === watching ? 'border-primary/60' : 'border-outline-variant/70'
              }`}
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <Icon name={look.icon} className={`${look.tone} text-[18px] ${look.spin ? 'animate-spin' : ''}`} />
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-semibold group-hover:text-primary">Run #{r.id}</div>
                  <div className={`text-[11px] font-mono truncate w-44 ${look.tone === 'text-tertiary' ? 'text-outline' : look.tone}`}>{look.text}</div>
                </div>
              </div>
              <div className="text-right font-mono text-[11px] shrink-0">
                <div>{fmtDuration(durationOf(r))}</div>
                <div className="text-outline">{ago(r.createdAt)}</div>
              </div>
            </a>
          );
        })}
      </div>
      <a className="block text-center py-1.5 font-mono text-[11px] text-primary hover:underline bg-surface-container rounded-lg border border-outline-variant/40" href="#/runs">
        Open all runs →
      </a>
    </div>
  );
}

export function NewRunPage({ queue, runs, refreshRuns, envs }: { queue: QueueState | null; runs: Run[] | null; refreshRuns: () => void; envs: Environment[] }) {

  const [localPath, setLocalPath] = useState(() => remembered('localPath', DEFAULT_LOCAL_PATH));
  const [tests, setTests] = useState<ManifestTest[] | null>(null);
  const [testsError, setTestsError] = useState('');
  const [test, setTest] = useState('');

  const [target, setTarget] = useState<'env' | 'url'>(() => (remembered('target', 'env') === 'url' ? 'url' : 'env'));
  const [env, setEnv] = useState('stage');
  const [url, setUrl] = useState(() => remembered('url', ''));
  const [deviceList, setDeviceList] = useState<Device[]>([]);
  const [devices, setDevices] = useState<string[]>(() => remembered('devices', 'desktop-chrome').split(',').filter(Boolean));
  const [note, setNote] = useState('');

  const [watchId, setWatchId] = useState<number | undefined>();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);

  useEffect(() => {
    api.devices().then(setDeviceList, () => {});
  }, []);

  // Test list from the folder's manifest.json, re-read shortly after the path changes.
  useEffect(() => {
    remember('localPath', localPath);
    setTests(null);
    setTestsError('');
    if (!localPath.trim()) return;
    const t = setTimeout(() => {
      api.tests(localPath.trim()).then(
        (list) => {
          setTests(list);
          setTest((cur) => (list.some((x) => x.id === cur) ? cur : (list[0]?.id ?? '')));
        },
        (err: Error) => setTestsError(err.message.includes('ENOENT') ? 'No manifest.json in that folder' : err.message),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [localPath]);

  // Follow the running run, or the latest one, until the user picks another.
  useEffect(() => {
    if (watchId !== undefined || !runs) return;
    const id = queue?.current ?? runs[0]?.id;
    if (id !== undefined && id !== null) setWatchId(id);
  }, [runs, queue, watchId]);

  const [watchedRun, setWatchedRun] = useState<Run | null>(null);
  useEffect(() => {
    setWatchedRun(null);
    if (watchId === undefined) return;
    const load = () => api.run(watchId).then(setWatchedRun, () => setWatchedRun(null));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [watchId]);
  const watched = watchedRun?.id === watchId ? watchedRun : null;
  const environment = envs.find((e) => e.name === env);
  const ahead = queue ? queue.waiting.length + (queue.current !== null ? 1 : 0) : 0;
  const typical = useMemo(() => {
    const done = (runs ?? []).filter((r) => r.status === 'passed' || r.status === 'passed_with_warnings').map(durationOf);
    const ms = done.filter((d): d is number => d !== null).sort((a, b) => a - b);
    return ms.length ? ms[Math.floor(ms.length / 2)]! : null;
  }, [runs]);

  const chosen = tests?.find((t) => t.id === test);
  // A test's manifest can limit it to desktop or mobile; devices outside that can't be picked.
  const allowed = (d: Device) => !chosen?.devices || chosen.devices.includes(d.kind);
  const picked = deviceList.filter((d) => devices.includes(d.id) && allowed(d)).map((d) => d.id);
  const toggleDevice = (id: string) =>
    setDevices((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      remember('devices', next.join(','));
      return next;
    });
  const urlOk = /^https?:\/\/\S+$/.test(url.trim());
  const problem = !tests
    ? testsError || 'Loading tests…'
    : !chosen
      ? 'Pick a test'
      : target === 'url' && !urlOk
        ? 'Type a full URL starting with https://'
        : picked.length === 0
          ? 'Pick at least one device'
          : '';

  const start = useCallback(async () => {
    if (problem || starting) return;
    setStarting(true);
    setMessage(null);
    remember('target', target);
    if (target === 'url') remember('url', url.trim());
    try {
      const { run, runsAhead } = await api.start({
        env,
        ...(target === 'url' ? { url: url.trim() } : {}),
        repo: REPO,
        branch: 'main',
        test,
        devices: picked,
        ...(note.trim() ? { note: note.trim() } : {}),
        localPath: localPath.trim(),
      });
      setWatchId(run.id);
      setNote('');
      setMessage({
        tone: 'text-tertiary',
        text: runsAhead ? `Run #${run.id} queued, ${runsAhead} ahead of it.` : `Run #${run.id} started.`,
      });
      refreshRuns();
    } catch (err) {
      setMessage({ tone: 'text-error', text: `Could not start the run: ${(err as Error).message}` });
    } finally {
      setStarting(false);
    }
  }, [problem, starting, target, url, env, test, picked, note, localPath, refreshRuns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const cancel = (id: number) =>
    api.cancel(id).then(refreshRuns, (err: Error) => setMessage({ tone: 'text-error', text: err.message }));


  const field =
    'w-full bg-surface-container-lowest border border-outline-variant rounded-lg font-mono text-[11px] text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40';

  return (
    <>
          {/* Hero */}
          <div className="border-b border-outline-variant bg-surface-dim/80 px-8 py-6">
            <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center space-x-3">
                  <h1 className="text-[24px] leading-8 font-semibold tracking-tight">New Run</h1>
                  <span className="px-2 py-0.5 rounded bg-surface-container border border-outline-variant font-mono text-[10px] font-semibold text-secondary uppercase">
                    URL mode
                  </span>
                </div>
                <p className="text-on-surface-variant max-w-3xl">
                  Pick the tests, where they run and the device. Runs go one at a time; you'll get a JSON and PDF report with the
                  team responsible if anything fails.
                </p>
                {message && <p className={`font-mono text-[11px] ${message.tone}`}>{message.text}</p>}
                {!message && problem && tests && <p className="font-mono text-[11px] text-outline">{problem}</p>}
              </div>
              <button
                type="button"
                onClick={start}
                disabled={!!problem || starting}
                title={problem || 'Start the run'}
                className="flex items-center space-x-2.5 px-4 py-2.5 bg-primary text-on-primary rounded-lg text-[12px] font-semibold hover:brightness-95 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 shrink-0"
              >
                <Icon name={starting ? 'progress_activity' : 'rocket_launch'} className={`text-[18px] ${starting ? 'animate-spin' : ''}`} />
                <div className="flex flex-col text-left">
                  <span className="leading-none">Start Run</span>
                  <span className="font-mono text-[11px] opacity-80 mt-0.5">
                    Ctrl + Enter{typical ? ` • usually ~${fmtDuration(typical)}` : ''}
                  </span>
                </div>
                {ahead > 0 && <span className="ml-2 px-1.5 py-0.5 bg-on-primary/15 rounded font-mono text-[10px] font-bold">{ahead} AHEAD</span>}
              </button>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-8 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-8 space-y-6">
                {/* 01 Tests from */}
                <section className="bg-surface-container-low border border-outline-variant border-t-2 border-t-primary/30 rounded-lg p-5">
                  <SectionHead
                    n="01"
                    title="Tests From"
                    right={
                      <Toggle
                        value="local"
                        onChange={() => {}}
                        options={[
                          { value: 'github', label: 'GitHub', disabled: 'Comes with GitHub mode (needs the server PAT)' },
                          { value: 'local', label: 'Local folder' },
                        ]}
                      />
                    }
                  />
                  <div className="space-y-1.5">
                    <label htmlFor="localPath" className="block text-[12px] font-medium text-on-surface-variant">
                      Folder with manifest.json (on the machine running Alibi)
                    </label>
                    <div className="relative">
                      <Icon name="folder_code" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]" />
                      <input
                        id="localPath"
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                        className={`${field} pl-10 py-2.5 font-semibold`}
                        placeholder={DEFAULT_LOCAL_PATH}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-surface-container rounded-lg border border-outline-variant/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[12px]">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <Icon name="fork_right" className="text-[16px] text-secondary" />
                      <span className="truncate">Tests run as they are in this folder, whatever branch you have checked out.</span>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0 font-mono text-[11px]">
                      {testsError ? (
                        <span className="text-error">{testsError}</span>
                      ) : tests ? (
                        <span className="text-secondary">
                          /alibi: {tests.length} test{tests.length === 1 ? '' : 's'} found
                        </span>
                      ) : (
                        <span className="text-outline">reading…</span>
                      )}
                    </div>
                  </div>
                </section>

                {/* 02 Other repos */}
                <section className="bg-surface-container-low border border-outline-variant border-t-2 border-t-primary/30 rounded-lg p-5 opacity-60">
                  <SectionHead
                    n="02"
                    title="Other Repos & Branches"
                    right={<span className="font-mono text-[11px] text-outline flex items-center gap-1"><Icon name="schedule" className="text-[14px]" />available once s3 is ready</span>}
                  />
                  <p className="text-[12px] text-on-surface-variant mb-4">
                    Extra services to deploy with your branch, e.g. a Cognito stage branch. Used in branch mode on s3; everything not
                    listed stays on main.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-outline-variant bg-surface-container font-mono text-[10px] tracking-wider text-outline uppercase">
                          <th className="py-2.5 px-4 font-semibold">Repo</th>
                          <th className="py-2.5 px-4 font-semibold">Branch</th>
                          <th className="py-2.5 px-4 font-semibold">Commit</th>
                          <th className="py-2.5 px-4 text-right font-semibold">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-[11px]">
                        <tr>
                          <td colSpan={4} className="py-3 px-4 text-outline">
                            Everything stays on main.
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="w-full mt-3 py-2 border border-dashed border-outline-variant text-outline rounded-lg font-mono text-[11px] flex items-center justify-center space-x-2 cursor-not-allowed"
                  >
                    <Icon name="playlist_add" className="text-[16px]" />
                    <span>Add repo + branch</span>
                  </button>
                </section>

                {/* 03 Tested on */}
                <section className="bg-surface-container-low border border-outline-variant border-t-2 border-t-primary/30 rounded-lg p-5">
                  <SectionHead n="03" title="Tested On" sub="Pick an environment or type a URL. One or the other." />
                  <div className="space-y-4">
                    <div
                      className={`p-4 rounded-lg bg-surface-container-lowest border border-outline-variant space-y-3 ${target === 'env' ? '' : 'opacity-75 hover:opacity-100'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center space-x-2.5 cursor-pointer">
                          <input
                            checked={target === 'env'}
                            onChange={() => setTarget('env')}
                            className="text-primary focus:ring-0 bg-surface-container border-outline-variant h-4 w-4"
                            name="env_mode"
                            type="radio"
                          />
                          <span className="font-semibold">Environment</span>
                        </label>
                        {environment?.apiBaseUrl && (
                          <span className="font-mono text-[11px] text-outline truncate">
                            Backend: <span className="text-primary">{host(environment.apiBaseUrl)}</span>
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        {(envs.length ? envs : [{ name: 'stage', baseUrl: 'https://s1-bond-scanner.one.phoenix.sustvest.in/' }]).map((e) => {
                          const on = target === 'env' && env === e.name;
                          return (
                            <button
                              type="button"
                              key={e.name}
                              onClick={() => {
                                setTarget('env');
                                setEnv(e.name);
                              }}
                              className={`p-3 rounded-lg text-left flex flex-col border ${on ? 'bg-primary/[0.08] border-primary' : 'bg-surface-container-low border-outline-variant hover:border-outline'}`}
                            >
                              <div className="flex items-center justify-between mb-2 w-full">
                                <span className="font-mono text-[10px] text-secondary uppercase font-semibold">s1</span>
                                <span className={`w-2 h-2 rounded-full ${on ? 'bg-tertiary' : 'bg-outline-variant'}`} />
                              </div>
                              <div className="font-semibold">{cap(e.name)}</div>
                              <span className="mt-2 text-[10px] text-outline font-mono truncate">{host(e.baseUrl)}</span>
                            </button>
                          );
                        })}
                        <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant flex flex-col opacity-50 cursor-not-allowed">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono text-[10px] text-outline uppercase font-semibold">s3</span>
                            <Icon name="schedule" className="text-[14px] text-outline" />
                          </div>
                          <div className="font-medium">Your branch on s3</div>
                          <span className="mt-2 text-[10px] text-outline font-mono">available once s3 is ready</span>
                        </div>
                      </div>
                    </div>
                    <div
                      className={`p-4 rounded-lg bg-surface-container-lowest border space-y-3 ${target === 'url' ? 'border-primary/60' : 'border-outline-variant opacity-75 hover:opacity-100'}`}
                    >
                      <label className="flex items-center space-x-2.5 cursor-pointer">
                        <input
                          checked={target === 'url'}
                          onChange={() => setTarget('url')}
                          className="text-primary focus:ring-0 bg-surface-container border-outline-variant h-4 w-4"
                          name="env_mode"
                          type="radio"
                        />
                        <span className="font-semibold">Custom URL</span>
                      </label>
                      <div className="relative">
                        <Icon name="link" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]" />
                        <input
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          onFocus={() => setTarget('url')}
                          className={`${field} bg-surface-container pl-10 py-2`}
                          placeholder="https://any-site-you-want-to-test"
                          type="url"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* 04 Test & device */}
                <section className="bg-surface-container-low border border-outline-variant border-t-2 border-t-primary/30 rounded-lg p-5">
                  <SectionHead
                    n="04"
                    title="Test & Device"
                    sub={
                      <>
                        Tests listed from the folder's{' '}
                        <code className="text-primary font-mono bg-surface-container px-1 rounded text-[12px]">manifest.json</code>.
                      </>
                    }
                    right={
                      tests && (
                        <span className="font-mono text-[11px] text-tertiary flex items-center space-x-1">
                          <Icon name="folder" className="text-[15px]" />
                          <span>
                            {tests.length} test{tests.length === 1 ? '' : 's'} found
                          </span>
                        </span>
                      )
                    }
                  />
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label htmlFor="test" className="block text-[12px] font-medium text-on-surface-variant">
                        Test
                      </label>
                      <div className="relative">
                        <select
                          id="test"
                          value={test}
                          onChange={(e) => setTest(e.target.value)}
                          disabled={!tests?.length}
                          className={`${field} appearance-none px-4 py-3 pr-10 bg-none disabled:opacity-60`}
                        >
                          {!tests?.length && <option value="">{testsError || 'No tests yet'}</option>}
                          {tests?.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title} ({t.file})
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-outline">
                          <Icon name="unfold_more" className="text-[20px]" />
                        </div>
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant space-y-4">
                      <div className="font-mono text-[10px] text-outline uppercase tracking-wider font-semibold">Run settings</div>
                      <div className="space-y-2 text-[12px]">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-on-surface-variant">Devices</span>
                          <span className="font-mono text-[10px] text-outline">
                            {picked.length > 1 ? `${picked.length} picked · tested one after another` : 'Pick one or more'}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                          {deviceList.map((d) => {
                            const ok = allowed(d);
                            const on = ok && devices.includes(d.id);
                            const [platform, browser] = d.label.split(' · ');
                            return (
                              <button
                                type="button"
                                key={d.id}
                                disabled={!ok}
                                title={ok ? undefined : `This test is ${chosen?.devices?.join(' / ')} only`}
                                onClick={() => toggleDevice(d.id)}
                                className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left ${
                                  on ? 'bg-primary/[0.08] border-primary' : 'bg-surface-container-low border-outline-variant hover:border-outline'
                                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-outline-variant`}
                              >
                                <Icon
                                  name={d.kind === 'mobile' ? 'smartphone' : 'computer'}
                                  className={`text-[18px] ${on ? 'text-primary' : 'text-outline'}`}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className={`font-medium leading-tight ${on ? 'text-on-surface' : 'text-on-surface-variant'}`}>{platform}</div>
                                  <div className="font-mono text-[10px] text-outline">{browser}</div>
                                </div>
                                <Icon
                                  name={on ? 'check_box' : 'check_box_outline_blank'}
                                  fill={on}
                                  className={`text-[18px] ${on ? 'text-primary' : 'text-outline'}`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[12px] pt-1">
                        <div className="space-y-1.5">
                          <span className="block font-medium text-on-surface-variant">Retries</span>
                          <span className="font-mono text-[11px]">1 per device</span>
                        </div>
                        <div className="space-y-1.5">
                          <span className="block font-medium text-on-surface-variant">Recording</span>
                          <div className="flex items-center space-x-2">
                            <Icon name="videocam" className="text-[16px] text-tertiary" />
                            <span className="font-mono text-[11px]">Video on failure</span>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <span className="block font-medium text-on-surface-variant">Time limit</span>
                          <span className="font-mono text-[11px]">30 min per run</span>
                        </div>
                      </div>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className={`${field} bg-surface-container px-3 py-2`}
                        placeholder="Note (optional), e.g. checking the new OTP screen"
                        type="text"
                      />
                    </div>
                  </div>
                </section>
              </div>

              {/* Right column */}
              <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-20">
                <LiveLog run={watched} onCancel={cancel} />
                <RecentRuns runs={runs} watching={watchId} />
              </div>
            </div>
          </div>
    </>
  );
}
