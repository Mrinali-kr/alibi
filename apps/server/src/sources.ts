import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { ROOT } from './paths.ts';
import type { RunParams } from './db.ts';

export type ManifestTest = {
  id: string;
  title: string;
  file: string;
  devices?: string[];
  timeout?: number;
};

type RepoConfig = { github: string };

function repoConfig(repo: string): RepoConfig {
  const repos: Record<string, RepoConfig> = JSON.parse(readFileSync(resolve(ROOT, 'config/repos.json'), 'utf8'));
  const cfg = repos[repo];
  if (!cfg) throw new Error(`Unknown repo "${repo}". Add it to config/repos.json.`);
  return cfg;
}

function githubHeaders(accept: string) {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error('GITHUB_PAT is not set in .env');
  return { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

type Source = Pick<RunParams, 'repo' | 'branch' | 'localPath'>;

/** Reads the test list from the repo's /alibi/manifest.json. */
export async function readManifest(src: Source): Promise<ManifestTest[]> {
  let text: string;
  if (src.localPath) {
    text = readFileSync(resolve(src.localPath, 'manifest.json'), 'utf8');
  } else {
    const { github } = repoConfig(src.repo);
    const url = `https://api.github.com/repos/${github}/contents/alibi/manifest.json?ref=${encodeURIComponent(src.branch)}`;
    const res = await fetch(url, { headers: githubHeaders('application/vnd.github.raw+json') });
    if (!res.ok) throw new Error(`Could not read alibi/manifest.json from ${github}@${src.branch} (GitHub ${res.status})`);
    text = await res.text();
  }
  return JSON.parse(text).tests;
}

/** Puts the repo's /alibi folder at `dest`, from a local folder or from GitHub at the chosen branch. */
export async function fetchTests(src: Source, dest: string) {
  mkdirSync(dest, { recursive: true });
  if (src.localPath) {
    if (!existsSync(resolve(src.localPath, 'manifest.json'))) {
      throw new Error(`No manifest.json in ${src.localPath}`);
    }
    cpSync(src.localPath, dest, { recursive: true });
    return;
  }

  const { github } = repoConfig(src.repo);
  const url = `https://api.github.com/repos/${github}/tarball/${encodeURIComponent(src.branch)}`;
  const res = await fetch(url, { headers: githubHeaders('application/vnd.github+json') });
  if (!res.ok || !res.body) throw new Error(`Could not download ${github}@${src.branch} (GitHub ${res.status})`);

  // The tarball's top folder is <owner>-<repo>-<sha>/; keep only <top>/alibi/** and drop both levels.
  await pipeline(
    Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
    tar.x({ cwd: dest, strip: 2, filter: (path) => path.split('/')[1] === 'alibi' }),
  );
  if (!existsSync(resolve(dest, 'manifest.json'))) {
    throw new Error(`${github}@${src.branch} has no alibi/manifest.json`);
  }
}
