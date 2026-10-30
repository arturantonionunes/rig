import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, RunStatus } from './types.js';

// A single parsed run-log line. Parse at the edge; trust the type after.
type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

// Returns a RunLine for a valid line, or null for a bad one (unparseable JSON
// or missing/ill-typed required fields). Never throws.
function parseLine(raw: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;

  if (typeof o.at !== 'string') return null;
  if (typeof o.job !== 'string') return null;
  if (!isStatus(o.status)) return null;

  // owner is required by the schema but may be null.
  let owner: string | null;
  if (o.owner === null) owner = null;
  else if (typeof o.owner === 'string') owner = o.owner;
  else return null;

  // error is optional; absent or null both mean "no error".
  let error: string | null = null;
  if (typeof o.error === 'string') error = o.error;
  else if (o.error !== undefined && o.error !== null) return null;

  return { at: o.at, job: o.job, status: o.status, owner, error };
}

// Accumulator while folding lines into one row per job.
type Acc = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  firstAt: string;
  lastAt: string;
  lastStatus: RunStatus;
  lastError: string | null;
};

// `at` carries an offset; string compare is not reliable across offsets, so
// compare by epoch millis. Falls back to string compare if ever unparseable
// (parseLine only guarantees a string, not a valid date).
function toEpoch(at: string): number {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
}

export function readNight(runsDir: string, night: string): DigestNight | null {
  const file = join(runsDir, `${night}.jsonl`);

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    // Missing file is signalled distinctly (null → 404). Anything else rethrows.
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  const lines = text.split('\n').filter((l) => l.trim() !== '');
  let badLines = 0;
  const byJob = new Map<string, Acc>();

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === null) {
      badLines += 1;
      continue;
    }
    const existing = byJob.get(parsed.job);
    if (existing === undefined) {
      byJob.set(parsed.job, {
        job: parsed.job,
        owner: parsed.owner,
        runs: 1,
        retries: parsed.status === 'retry' ? 1 : 0,
        firstAt: parsed.at,
        lastAt: parsed.at,
        lastStatus: parsed.status,
        lastError: parsed.error,
      });
      continue;
    }

    existing.runs += 1;
    if (parsed.status === 'retry') existing.retries += 1;

    const at = toEpoch(parsed.at);
    if (at < toEpoch(existing.firstAt)) {
      existing.firstAt = parsed.at;
    }
    if (at >= toEpoch(existing.lastAt)) {
      // >= so that ties keep the later-seen line as "last".
      existing.lastAt = parsed.at;
      existing.lastStatus = parsed.status;
      existing.lastError = parsed.error;
      existing.owner = parsed.owner;
    }
  }

  const rows: DigestRow[] = [...byJob.values()]
    .map((a) => ({
      job: a.job,
      owner: a.owner,
      runs: a.runs,
      retries: a.retries,
      lastStatus: a.lastStatus,
      lastError: a.lastError,
      firstAt: a.firstAt,
      lastAt: a.lastAt,
    }))
    .sort((x, y) => (x.job < y.job ? -1 : x.job > y.job ? 1 : 0));

  return {
    night,
    totalLines: lines.length,
    badLines,
    rows,
  };
}
