import { Icon, type Route } from './ui.tsx';
import type { QueueState } from './api.ts';

export function TopBar({ queue, onSearch }: { queue: QueueState | null; onSearch: (q: string) => void }) {
  const busy = queue?.current != null;
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between w-full h-14 px-6 bg-surface-dim/95 backdrop-blur border-b border-outline-variant">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2.5">
          <span className="text-[18px] font-bold tracking-tight">Alibi</span>
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant ml-1">
            {queue === null ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-error" />
                <span className="font-mono text-[10px] font-semibold tracking-wider text-error">RUNNER OFFLINE</span>
              </>
            ) : busy ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[10px] font-semibold tracking-wider text-primary">RUNNING #{queue.current}</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                <span className="font-mono text-[10px] font-semibold tracking-wider text-tertiary">RUNNER READY</span>
              </>
            )}
          </div>
        </div>
      </div>
      <form
        className="flex-1 max-w-xl mx-6 hidden md:block"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement;
          onSearch(input.value.trim());
        }}
      >
        <div className="relative w-full">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]" />
          <input
            id="search"
            name="q"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-9 pr-14 py-1.5 font-mono text-[11px] text-on-surface placeholder-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
            placeholder="Search runs by #, test, device, note or URL..."
            type="text"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] bg-surface-container px-1.5 py-0.5 rounded text-outline border border-outline-variant">
            Ctrl K
          </span>
        </div>
      </form>
      <div className="flex items-center space-x-3">
        <div className="relative pl-3 border-l border-outline-variant flex items-center gap-2">
          <span className="font-mono text-[11px] text-outline">local</span>
          <div className="w-7 h-7 rounded-full border border-outline-variant bg-surface-container-high flex items-center justify-center text-[12px] font-semibold">
            M
          </div>
        </div>
      </div>
    </header>
  );
}

export function SideBar({ route, queued, envLabel }: { route: Route; queued: number; envLabel: string }) {
  const soon = 'Coming in a later step';
  const base = 'flex items-center space-x-2.5 px-3 py-2 rounded-lg';
  const on = `${base} bg-primary text-on-primary font-semibold`;
  const off = `${base} text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high`;
  const later = `${base} text-on-surface-variant opacity-60 cursor-not-allowed`;
  const runsPage = route.page === 'runs' || route.page === 'run';
  return (
    <aside className="w-60 flex-shrink-0 hidden md:flex flex-col justify-between p-2 bg-surface-dim border-r border-outline-variant sticky top-14 h-[calc(100vh-3.5rem)]">
      <div>
        <div className="flex items-center space-x-2.5 p-2 rounded-lg bg-surface-container-low border border-outline-variant/50 mb-3">
          <div className="w-7 h-7 rounded bg-primary-container/20 border border-primary/30 flex items-center justify-center text-primary">
            <Icon name="dns" className="text-[18px]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[15px] font-semibold truncate leading-tight">Bondscanner</span>
            <span className="font-mono text-[11px] text-outline truncate">{envLabel}</span>
          </div>
        </div>
        <a
          href="#/"
          className="w-full mb-3 flex items-center justify-center space-x-2 py-2 px-3 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg text-primary text-[12px] font-medium"
        >
          <Icon name="add_circle" className="text-[16px]" />
          <span>New Run</span>
        </a>
        <div className="space-y-1 text-[12px] font-medium">
          <a className={route.page === 'new' ? on : off} href="#/">
            <Icon name="play_circle" fill={route.page === 'new'} className="text-[18px]" />
            <span>New Run</span>
          </a>
          <a className={runsPage ? on : off} href="#/runs">
            <Icon name="history" className="text-[18px]" />
            <span>Runs</span>
            {queued > 0 && (
              <span className={`ml-auto font-mono text-[10px] px-1.5 rounded border ${runsPage ? 'border-on-primary/30' : 'bg-surface-container border-outline-variant'}`}>
                {queued} queued
              </span>
            )}
          </a>
          <span className={later} title={soon}>
            <Icon name="checklist" className="text-[18px]" />
            <span>Tests</span>
          </span>
          <span className={later} title={soon}>
            <Icon name="dns" className="text-[18px]" />
            <span>Environments</span>
          </span>
          <span className={later} title="Each run's PDF and JSON are on its page under Runs">
            <Icon name="description" className="text-[18px]" />
            <span>Reports</span>
          </span>
        </div>
      </div>
      <div className="border-t border-outline-variant pt-2 space-y-1 text-[12px] font-medium">
        <span className={later} title={soon}>
          <Icon name="menu_book" className="text-[18px]" />
          <span>How to write a test</span>
        </span>
        <span className={`${base} text-on-surface-variant`}>
          <Icon name="check_circle" className="text-[18px] text-tertiary" />
          <span>Runner status</span>
        </span>
      </div>
    </aside>
  );
}
