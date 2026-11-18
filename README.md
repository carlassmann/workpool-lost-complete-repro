# workpool: a lost `complete` keeps a mutation job "running" forever

Minimal repro for `@convex-dev/workpool`: when a mutation job succeeds but the
`complete` mutation that `runMutationWrapper` schedules fails, recovery never
frees the job. It keeps its `maxParallelism` slot and its `onComplete` never runs.

## Run

```sh
npm install      # postinstall injects the fault (scripts/inject-fault.mjs)
npm run repro    # ~9 min; exits 1 when the bug reproduces
```

`npm run repro` wipes and starts the local Convex backend (`npx convex dev`, anonymous
local deployment on port 3210), enqueues two mutation jobs on a `maxParallelism: 1`
pool, and polls for 8 minutes, past the 5-minute recovery threshold. Set `WATCH_MS` to
change the watch time.

Latest versions: `npm install @convex-dev/workpool@latest convex@latest && npm run repro`.

Recorded runs: `logs/repro-0.4.14.log` (convex 1.46.0) and `logs/repro-0.4.16.log` (convex 1.51.0); both reproduce.

### Why a local backend, not convex-test

Recovery decides from the real `_scheduled_functions` state (`success` / `failed`)
and runs from the main loop's periodic scan. That needs the real scheduler and
real time, which a local backend gives without mocks.

### The fault injection

A real platform error (seen in production as `Your request timed out performing too
many system operations` on `complete:complete`) can't be triggered on demand.
`scripts/inject-fault.mjs` wraps the component's scheduled `complete` entry point in
`dist/component/complete.js` so it throws when the job's function returned
`"LOSE_COMPLETE"`. Recovery's own direct `completeHandler` call is untouched. Nothing
else is changed.

## Draft upstream issue

**Title:** Mutation job stays "running" forever when its scheduled `complete` fails

**Versions:** `@convex-dev/workpool` 0.4.14 and 0.4.16 (latest), `convex` 1.46.0 and
1.51.0, local backend.

**Steps**

1. Pool with `maxParallelism: 1`. Enqueue mutation job A with an `onComplete`, then job B.
2. A's `runMutationWrapper` commits (scheduled function state `success`) and schedules
   `complete:complete`.
3. That `complete` fails (in production: a platform error such as "Your request timed
   out performing too many system operations"; in the repro: an injected throw).

Repro: <link to repo>, `npm install && npm run repro`.

**Expected:** within the recovery window (5 min) A leaves `running`, its `onComplete`
runs, and B starts.

**Actual:** after 8+ minutes `status(A)` is still `running`, A's `onComplete` never ran,
B stays `pending`. The pool is wedged until someone calls `complete:complete` by hand.

```
complete.js:complete         failed: Uncaught Error: injected: simulated platform error in complete
worker.js:runMutationWrapper success
t+8.0min {"completions":[],"jobRuns":["lost"],"status":{"lost":{"state":"running"},"waiting":{"state":"pending"}}}
```

**Cause:** `recoveryHandler` (`src/component/recovery.ts`, `switch (scheduled.state.kind)`)
only completes jobs whose scheduled function is `failed`, `canceled` or missing. A
`success` wrapper whose `complete` was lost has no `pendingCompletion`, the work still
exists at the same attempt, and the switch has no `success` case, so it is skipped on
every scan. The same applies to actions/queries if `runBatch`'s `completeInline`
fallback `complete` fails (by reading, not reproduced here).

**Suggested fix direction:**

- Make the success result durable in the wrapper's own transaction (e.g. write the
  `runResult` to a table next to the work, or call `completeHandler` inline as the
  opt-in `completeTransactionally` in #238 does, but by default), so recovery can apply
  it when `complete` is lost.
- Or, in recovery, handle `success`: find the job's `complete:complete` in the
  component's `_scheduled_functions`, and if it `failed`/`canceled`, apply its
  `runResult` again (it carries the real return value an `onComplete` needs); if none is
  found, complete with a non-retryable failure instead of re-running the mutation.

Related: #238 (opt-in transactional completion; default path unchanged), #240 / #217
(recover mutations stuck `pending` in the scheduler; doesn't cover `success`).

---
written with claude-opus-5-5 in T3 Code
