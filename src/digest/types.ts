// The run-log digest contract. Section 2 (views/routes) builds against this file.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per distinct job in a night's run log.
export type DigestRow = {
  job: string;
  owner: string | null; // may be null; the view shows null as — (kept, never dropped)
  runs: number; // count of valid lines for this job
  retries: number; // count of lines with status "retry" for this job
  lastStatus: RunStatus; // status of the chronologically last line for this job
  lastError: string | null; // error of the chronologically last line (null if none)
  firstAt: string; // earliest `at`, kept verbatim with its offset (never converted to UTC)
  lastAt: string; // latest `at`, kept verbatim with its offset
};

// The result of reading one night. A night with no valid lines still renders
// ("nothing ran"); a missing file is signalled distinctly by readNight returning
// null (see read.ts), so the route can answer 404 vs "nothing ran".
export type DigestNight = {
  night: string; // the night id, e.g. "2026-10-28"
  totalLines: number; // total non-empty lines seen in the file
  badLines: number; // lines that did not parse / were missing required fields
  rows: DigestRow[]; // one per distinct job, sorted ascending by job name
};

// Read runs/<night>.jsonl into one DigestNight.
// Returns null when the night's file does not exist (caller renders 404).
// Any other read error throws.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
