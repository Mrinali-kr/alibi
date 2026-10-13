import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type TestData = {
  phoneFirstDigits: string;
  phoneLength: number;
  otp: string;
  pin: string;
};

type Profile = {
  baseUrl: string;
  testData: TestData;
};

export type AlibiEnv = {
  name: string;
  baseUrl: string;
  otp: string;
  pin: string;
  /** A phone number not used before, so every run takes the same path. */
  newPhone: () => string;
};

function loadEnv(): AlibiEnv {
  const name = process.env.ALIBI_ENV ?? 'stage';
  const file = process.env.ALIBI_CONFIG ?? resolve(process.cwd(), 'config/environments.json');
  const profiles: Record<string, Profile> = JSON.parse(readFileSync(file, 'utf8'));
  const profile = profiles[name];
  if (!profile) throw new Error(`Unknown environment "${name}" in ${file}`);

  const data = profile.testData;
  return {
    name,
    // URL mode: a pasted URL wins over the profile's own.
    baseUrl: process.env.ALIBI_BASE_URL ?? profile.baseUrl,
    otp: data.otp,
    pin: data.pin,
    newPhone: () => {
      const first = data.phoneFirstDigits[Math.floor(Math.random() * data.phoneFirstDigits.length)];
      let rest = '';
      for (let i = 1; i < data.phoneLength; i++) rest += Math.floor(Math.random() * 10);
      return first + rest;
    },
  };
}

export const test = base.extend<{ env: AlibiEnv }>({
  env: async ({}, use) => {
    await use(loadEnv());
  },
});

/** A named step. Each one becomes a row in the report. */
export const step = <T>(name: string, body: () => Promise<T>) => test.step(name, body);

/** A soft check: records a warning in the report without stopping the test. */
export function warn(ok: boolean, message: string) {
  if (!ok) test.info().annotations.push({ type: 'warning', description: message });
}

export { expect };
