import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Repo root: apps/server/src -> ../../..
export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const REPORTS_DIR = resolve(ROOT, 'reports');
export const DATA_DIR = resolve(ROOT, 'data');

export const runDir = (id: number) => resolve(REPORTS_DIR, String(id));
