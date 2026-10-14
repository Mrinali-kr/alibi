import { useCallback, useEffect, useState } from 'react';
import { api, type Environment } from './api.ts';
import { SideBar, TopBar } from './layout.tsx';
import { NewRunPage } from './NewRun.tsx';
import { RunDetail } from './RunDetail.tsx';
import { RunsPage } from './RunsPage.tsx';
import { cap, parseRoute, usePoll } from './ui.tsx';

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [queue] = usePoll(api.queue, 2000);
  const loadRuns = useCallback(() => api.runs(200), []);
  const [runs, refreshRuns] = usePoll(loadRuns, 3000);

  useEffect(() => {
    api.environments().then(setEnvs, () => {});
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo({ top: 0 });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      }
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // "12" or "#12" opens that run; anything else filters the Runs list.
  const search = (q: string) => {
    const n = q.replace(/^#/, '');
    location.hash = /^\d+$/.test(n) ? `#/runs/${n}` : `#/runs?q=${encodeURIComponent(q)}`;
  };

  const env = envs.find((e) => e.name === 'stage') ?? envs[0];

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar queue={queue} onSearch={search} />
      <div className="flex flex-1">
        <SideBar route={route} queued={queue?.waiting.length ?? 0} envLabel={env ? `${cap(env.name)} · Phoenix s1` : 'Stage · Phoenix s1'} />
        <main className="flex-1 min-w-0 bg-background">
          {route.page === 'new' && <NewRunPage queue={queue} runs={runs?.slice(0, 6) ?? null} refreshRuns={refreshRuns} envs={envs} />}
          {route.page === 'runs' && (
            <RunsPage runs={runs} q={route.q} onQuery={(q) => {
                history.replaceState(null, '', `#/runs?q=${encodeURIComponent(q)}`);
                setRoute({ page: 'runs', q });
              }} />
          )}
          {route.page === 'run' && <RunDetail id={route.id} onChanged={refreshRuns} />}
        </main>
      </div>
    </div>
  );
}
