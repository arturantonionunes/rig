import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { lastBeat, type Beat } from './heartbeat.js';
import { readNight } from './digest/read.js';

// Per-night summary for the status board: the night id plus counts of jobs
// bucketed by their final (last) status for that night.
export type NightSummary = {
  night: string;
  ok: number;
  retry: number;
  fail: number;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightSummary[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Bucket a night's rows by lastStatus into ok/retry/fail counts.
function summarizeNight(runsDir: string, night: string): NightSummary {
  const digest = readNight(runsDir, night);
  const summary: NightSummary = { night, ok: 0, retry: 0, fail: 0 };
  if (digest === null) return summary;
  for (const row of digest.rows) {
    summary[row.lastStatus] += 1;
  }
  return summary;
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((night) => summarizeNight(config.runsDir, night)),
  };
}
