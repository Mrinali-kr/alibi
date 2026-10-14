import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './paths.ts';

export type Device = { id: string; label: string; kind: 'desktop' | 'mobile' };

export function deviceList(): Device[] {
  const raw: Record<string, Omit<Device, 'id'>> = JSON.parse(readFileSync(resolve(ROOT, 'config/devices.json'), 'utf8'));
  return Object.entries(raw).map(([id, d]) => ({ id, label: d.label, kind: d.kind }));
}

// Runs from before device choice said only desktop or mobile.
const OLD_NAMES: Record<string, string> = { desktop: 'desktop-chrome', mobile: 'android' };

/** The devices a run uses, whether it was started with `devices` or the older single `device`. */
export function devicesOf(p: { devices?: string[] | undefined; device?: string | undefined }): string[] {
  const ids = p.devices?.length ? p.devices : [p.device ?? 'desktop-chrome'];
  return [...new Set(ids.map((d) => OLD_NAMES[d] ?? d))];
}

export const labelOf = (id: string) => deviceList().find((d) => d.id === id)?.label ?? id;
