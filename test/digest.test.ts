import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';
import type { DigestRow } from '../src/digest/types.js';

const RUNS = 'runs';

function row(night: ReturnType<typeof readNight>, job: string): DigestRow {
  if (night === null) throw new Error('expected a night, got null');
  const found = night.rows.find((r) => r.job === job);
  if (found === undefined) throw new Error(`no row for job ${job}`);
  return found;
}

describe('readNight on the 2026-10-28 fixture', () => {
  const night = readNight(RUNS, '2026-10-28');

  it('reports the night id and one bad (truncated) line', () => {
    if (night === null) throw new Error('expected a night, got null');
    expect(night.night).toBe('2026-10-28');
    expect(night.badLines).toBe(1);
    expect(night.totalLines).toBe(16);
  });

  it('yields 5 distinct jobs', () => {
    if (night === null) throw new Error('expected a night, got null');
    expect(night.rows).toHaveLength(5);
  });

  it('returns rows sorted ascending by job name', () => {
    if (night === null) throw new Error('expected a night, got null');
    const jobs = night.rows.map((r) => r.job);
    expect(jobs).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts retries for fixtures/refresh and keeps its ok last status', () => {
    const r = row(night, 'fixtures/refresh');
    expect(r.runs).toBe(4);
    expect(r.retries).toBe(3);
    expect(r.lastStatus).toBe('ok');
    expect(r.lastError).toBeNull();
    expect(r.firstAt).toBe('2026-10-29T01:30:00+01:00');
    expect(r.lastAt).toBe('2026-10-29T01:37:00+01:00');
  });

  it('keeps notes/backup last status fail with its error', () => {
    const r = row(night, 'notes/backup');
    expect(r.lastStatus).toBe('fail');
    expect(r.lastError).toBe('quota exceeded');
    expect(r.owner).toBe('lane-07');
  });

  it('keeps a null owner (digest/render) rather than dropping the row', () => {
    const r = row(night, 'digest/render');
    expect(r.owner).toBeNull();
    expect(r.runs).toBe(1);
    expect(r.lastStatus).toBe('ok');
  });

  it('keeps offsets verbatim and counts all valid lane/sync lines', () => {
    const r = row(night, 'lane/sync');
    expect(r.runs).toBe(8);
    expect(r.retries).toBe(1);
    expect(r.firstAt).toBe('2026-10-28T23:00:06+01:00');
    expect(r.lastAt).toBe('2026-10-29T05:00:04+01:00');
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a missing night file (distinct from "nothing ran")', () => {
    expect(readNight(RUNS, '1999-01-01')).toBeNull();
  });

  it('returns an empty-but-present night for an empty file', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '', 'utf8');
    const night = readNight(dir, '2026-01-01');
    if (night === null) throw new Error('expected a night, got null');
    expect(night.totalLines).toBe(0);
    expect(night.badLines).toBe(0);
    expect(night.rows).toHaveLength(0);
  });
});
