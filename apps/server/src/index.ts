import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { ROOT, REPORTS_DIR } from './paths.ts';
import { createRun, getRun, listRuns, markInterrupted, FINISHED, type RunParams } from './db.ts';
import { cancel, kick, runsAhead, queueState } from './queue.ts';
import { readManifest } from './sources.ts';
import { logEvents, logFile } from './logs.ts';
import { deviceList, devicesOf } from './devices.ts';

try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // No .env yet; GitHub runs will say GITHUB_PAT is missing, local-folder runs still work.
}

mkdirSync(REPORTS_DIR, { recursive: true });
markInterrupted();

const app = Fastify({ logger: { level: 'info' } });

// Reports, traces and the Playwright HTML report for each run: /reports/<run>/html/index.html
await app.register(fastifyStatic, { root: REPORTS_DIR, prefix: '/reports/' });

// The web UI, once built with `npm run build:web`.
const WEB_DIR = resolve(ROOT, 'apps/web/dist');
if (existsSync(WEB_DIR)) {
  await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/', decorateReply: false });
} else {
  app.get('/', async () => 'Alibi runner is up. Build the UI with: npm run build:web');
}

const runBody = {
  type: 'object',
  required: ['repo', 'test'],
  additionalProperties: false,
  properties: {
    env: { type: 'string', default: 'stage' },
    url: { type: 'string' },
    repo: { type: 'string' },
    branch: { type: 'string', default: 'main' },
    test: { type: 'string' },
    devices: { type: 'array', items: { type: 'string' }, minItems: 1 },
    device: { type: 'string' },
    note: { type: 'string' },
    localPath: { type: 'string' },
  },
} as const;

app.post<{ Body: RunParams }>('/runs', { schema: { body: runBody } }, async (req, reply) => {
  const devices = devicesOf(req.body);
  const known = deviceList().map((d) => d.id);
  const unknown = devices.filter((d) => !known.includes(d));
  if (unknown.length) return reply.code(400).send({ error: `Unknown device: ${unknown.join(', ')}` });
  const { device: _old, ...rest } = req.body;
  const run = createRun({ ...rest, devices }, 'local');
  kick();
  return reply.code(201).send({ run, runsAhead: runsAhead(run.id) });
});

app.get<{ Querystring: { limit?: number } }>('/runs', async (req) => listRuns(Number(req.query.limit ?? 50)));

app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
  const run = getRun(Number(req.params.id));
  if (!run) return reply.code(404).send({ error: 'No such run' });
  return { ...run, runsAhead: runsAhead(run.id), report: `/reports/${run.id}/html/index.html` };
});

app.post<{ Params: { id: string } }>('/runs/:id/cancel', async (req, reply) => {
  const ok = cancel(Number(req.params.id));
  if (!ok) return reply.code(409).send({ error: 'Run is not queued or running' });
  return { ok };
});

app.post<{ Params: { id: string } }>('/runs/:id/rerun', async (req, reply) => {
  const old = getRun(Number(req.params.id));
  if (!old) return reply.code(404).send({ error: 'No such run' });
  const run = createRun(old.params, 'local');
  kick();
  return reply.code(201).send({ run, runsAhead: runsAhead(run.id) });
});

// Live log as server-sent events: everything so far, then new lines until the run ends.
app.get<{ Params: { id: string } }>('/runs/:id/log', (req, reply) => {
  const id = Number(req.params.id);
  const run = getRun(id);
  if (!run) return reply.code(404).send({ error: 'No such run' });

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (text: string) => res.write(`data: ${JSON.stringify(text)}\n\n`);
  const close = () => {
    res.write('event: end\ndata: {}\n\n');
    res.end();
  };

  if (existsSync(logFile(id))) send(readFileSync(logFile(id), 'utf8'));
  if (FINISHED.includes(getRun(id)!.status)) return close();

  const onLog = (t: string) => send(t);
  const onEnd = () => {
    cleanup();
    close();
  };
  const cleanup = () => {
    logEvents.off(`log:${id}`, onLog);
    logEvents.off(`end:${id}`, onEnd);
  };
  logEvents.on(`log:${id}`, onLog);
  logEvents.on(`end:${id}`, onEnd);
  req.raw.on('close', cleanup);
});

app.get('/queue', async () => queueState());

app.get('/devices', async () => deviceList());

// Environments for the run form; test data stays on the server.
app.get('/environments', async () => {
  const envs: Record<string, { baseUrl: string; apiBaseUrl?: string }> = JSON.parse(
    readFileSync(resolve(ROOT, 'config/environments.json'), 'utf8'),
  );
  return Object.entries(envs).map(([name, e]) => ({ name, baseUrl: e.baseUrl, apiBaseUrl: e.apiBaseUrl }));
});

app.get<{ Querystring: { repo: string; branch?: string; localPath?: string } }>('/tests', async (req, reply) => {
  const { repo, branch = 'main', localPath } = req.query;
  if (!repo && !localPath) return reply.code(400).send({ error: 'Give repo (and branch) or localPath' });
  try {
    return await readManifest({ repo, branch, ...(localPath ? { localPath } : {}) });
  } catch (err) {
    return reply.code(502).send({ error: (err as Error).message });
  }
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
kick();
