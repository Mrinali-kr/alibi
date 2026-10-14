import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { maskBody, maskUrl } from './mask.ts';

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

export type CapturedEvent = { step: string; at: number };
export type Captured = {
  consoleErrors: (CapturedEvent & { text: string; location?: string | undefined })[];
  pageErrors: (CapturedEvent & { message: string; stack?: string | undefined })[];
  failedRequests: (CapturedEvent & {
    method: string;
    url: string;
    resourceType: string;
    status: number | null;
    error?: string | undefined;
    body?: string | undefined;
  })[];
};

// Only calls that matter for a user flow; images, fonts and trackers are left out.
const WATCHED_TYPES = new Set(['document', 'xhr', 'fetch']);

let activePage: Page | null = null;
let currentStep = '(before first step)';
let stepCount = 0;

export const test = base.extend<{ env: AlibiEnv; alibiCapture: void }>({
  env: async ({}, use) => {
    await use(loadEnv());
  },

  // Runs for every test without being asked for: records errors and failed calls per step.
  alibiCapture: [
    async ({ page }, use, testInfo) => {
      const cap: Captured = { consoleErrors: [], pageErrors: [], failedRequests: [] };
      const pending: Promise<unknown>[] = [];
      activePage = page;
      currentStep = '(before first step)';
      stepCount = 0;

      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const loc = msg.location();
        cap.consoleErrors.push({
          step: currentStep,
          at: Date.now(),
          text: msg.text(),
          location: loc.url ? `${maskUrl(loc.url)}:${loc.lineNumber}:${loc.columnNumber}` : undefined,
        });
      });
      page.on('pageerror', (err) => {
        cap.pageErrors.push({ step: currentStep, at: Date.now(), message: err.message, stack: err.stack });
      });
      page.on('requestfailed', (req) => {
        if (!WATCHED_TYPES.has(req.resourceType())) return;
        cap.failedRequests.push({
          step: currentStep,
          at: Date.now(),
          method: req.method(),
          url: maskUrl(req.url()),
          resourceType: req.resourceType(),
          status: null,
          error: req.failure()?.errorText,
        });
      });
      page.on('response', (res) => {
        const req = res.request();
        if (res.status() < 400 || !WATCHED_TYPES.has(req.resourceType())) return;
        const entry: Captured['failedRequests'][number] = {
          step: currentStep,
          at: Date.now(),
          method: req.method(),
          url: maskUrl(res.url()),
          resourceType: req.resourceType(),
          status: res.status(),
        };
        cap.failedRequests.push(entry);
        pending.push(res.text().then((t) => (entry.body = maskBody(t)), () => undefined));
      });

      await use();

      await Promise.all(pending);
      const file = testInfo.outputPath('alibi-capture.json');
      writeFileSync(file, JSON.stringify(cap, null, 2));
      await testInfo.attach('alibi-capture', { path: file, contentType: 'application/json' });
      activePage = null;
    },
    { auto: true },
  ],
});

/** A named step. Each one becomes a row in the report, with a screenshot taken at its end. */
export function step<T>(name: string, body: () => Promise<T>): Promise<T> {
  return test.step(name, async () => {
    currentStep = name;
    const n = ++stepCount;
    try {
      return await body();
    } finally {
      const page = activePage;
      if (page && !page.isClosed()) {
        const file = test.info().outputPath(`step-${n}.png`);
        const ok = await page.screenshot({ path: file }).then(() => true, () => false);
        if (ok) await test.info().attach(`step-${n}: ${name}`, { path: file, contentType: 'image/png' });
      }
    }
  });
}

/** A soft check: records a warning in the report without stopping the test. */
export function warn(ok: boolean, message: string) {
  if (!ok) test.info().annotations.push({ type: 'warning', description: message });
}

/** Marks the current step as skipped in the report (it still counts as passed). */
export function skipStep(reason: string) {
  test.info().annotations.push({ type: 'skipped-step', description: `${currentStep}: ${reason}` });
}

export { expect };
