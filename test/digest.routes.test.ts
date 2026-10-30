import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

// A night with 3 distinct jobs: one plain ok job, one job with 3 retries
// (warn via retries >= 3), one job whose last status is "fail" (warn via
// lastStatus), plus one unparseable line to exercise badLines counting.
const GOOD_NIGHT = '2026-01-01';
const GOOD_LINES = [
  '{"at":"2026-01-01T01:00:00+01:00","job":"alpha/task","status":"ok","owner":"lane-07","error":null}',
  '{"at":"2026-01-01T01:05:00+01:00","job":"beta/retry","status":"retry","owner":"lane-07","error":"timeout"}',
  '{"at":"2026-01-01T01:06:00+01:00","job":"beta/retry","status":"retry","owner":"lane-07","error":"timeout"}',
  '{"at":"2026-01-01T01:07:00+01:00","job":"beta/retry","status":"retry","owner":"lane-07","error":"timeout"}',
  '{"at":"2026-01-01T01:08:00+01:00","job":"beta/retry","status":"ok","owner":"lane-07","error":null}',
  '{"at":"2026-01-01T01:10:00+01:00","job":"gamma/fail","status":"fail","owner":"lane-07","error":"boom"}',
  'this is not valid json',
].join('\n');

// A missing night: no file at all.
const MISSING_NIGHT = '2000-12-31';

// An "empty" night: the file exists but has zero valid rows (one bad line
// only), so the route must still answer 200 with "nothing ran", not 404.
const EMPTY_NIGHT = '2026-02-02';
const EMPTY_LINES = 'not json at all';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-'));
  writeFileSync(join(dir, `${GOOD_NIGHT}.jsonl`), GOOD_LINES, 'utf8');
  writeFileSync(join(dir, `${EMPTY_NIGHT}.jsonl`), EMPTY_LINES, 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
}

describe('GET /digest/:night', () => {
  it('renders a good night with its jobs and a warn row', async () => {
    const res = await app().request(`/digest/${GOOD_NIGHT}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('alpha/task');
    expect(html).toContain('beta/retry');
    expect(html).toContain('gamma/fail');
    expect(html).toContain('class="warn"');
  });

  it('renders the good jobs in ascending order even with a bad line present', async () => {
    const res = await app().request(`/digest/${GOOD_NIGHT}`);
    const html = await res.text();
    const alphaIdx = html.indexOf('alpha/task');
    const betaIdx = html.indexOf('beta/retry');
    const gammaIdx = html.indexOf('gamma/fail');
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(betaIdx).toBeGreaterThan(alphaIdx);
    expect(gammaIdx).toBeGreaterThan(betaIdx);
  });

  it('404s for a missing night', async () => {
    const res = await app().request(`/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
  });

  it('200s with "nothing ran" for a night with zero valid rows', async () => {
    const res = await app().request(`/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('nothing ran');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the good night as JSON, sorted ascending by job, matching the page', async () => {
    const res = await app().request(`/api/digest/${GOOD_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.night).toBe(GOOD_NIGHT);
    expect(body.rows).toHaveLength(3);

    const jobs = body.rows.map((r) => r.job);
    expect(jobs).toEqual(['alpha/task', 'beta/retry', 'gamma/fail']);

    // Parity with the page (ADR 0001): same jobs, same order.
    const pageRes = await app().request(`/digest/${GOOD_NIGHT}`);
    const html = await pageRes.text();
    const pageOrder = jobs.map((j) => html.indexOf(j));
    expect(pageOrder).toEqual([...pageOrder].sort((a, b) => a - b));

    const beta = body.rows.find((r) => r.job === 'beta/retry');
    if (beta === undefined) throw new Error('expected a row for beta/retry');
    expect(beta.retries).toBeGreaterThanOrEqual(3);

    const gamma = body.rows.find((r) => r.job === 'gamma/fail');
    if (gamma === undefined) throw new Error('expected a row for gamma/fail');
    expect(gamma.lastStatus).toBe('fail');
  });

  it('counts the bad line on the good night', async () => {
    const res = await app().request(`/api/digest/${GOOD_NIGHT}`);
    const body = (await res.json()) as DigestNight;
    expect(body.badLines).toBeGreaterThanOrEqual(1);
    const jobs = body.rows.map((r) => r.job);
    expect(jobs).toContain('alpha/task');
    expect(jobs).toContain('beta/retry');
    expect(jobs).toContain('gamma/fail');
  });

  it('404s for a missing night', async () => {
    const res = await app().request(`/api/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; night: string };
    expect(body.error).toBe('not found');
    expect(body.night).toBe(MISSING_NIGHT);
  });

  it('returns rows: [] with badLines > 0 for the bad-line-only night', async () => {
    const res = await app().request(`/api/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBeGreaterThan(0);
  });
});
