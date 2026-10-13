import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runDir } from './paths.ts';

// Live log lines per run, for anyone watching while it runs.
export const logEvents = new EventEmitter();
logEvents.setMaxListeners(100);

export const logFile = (id: number) => resolve(runDir(id), 'log.txt');

export function writeLog(id: number, text: string) {
  appendFileSync(logFile(id), text);
  logEvents.emit(`log:${id}`, text);
}

export function endLog(id: number) {
  logEvents.emit(`end:${id}`);
}
