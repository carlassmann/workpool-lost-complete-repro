# workpool: lost `complete` keeps a mutation job running forever

```sh
npm install     # postinstall: scripts/inject-fault.mjs makes the scheduled `complete` throw for one job
npm run repro   # local backend, ~9 min, exits 1 when reproduced
```

Logs in `logs/` (0.4.14, 0.4.16, 0.5.0). The repro uses a local backend instead of convex-test because recovery depends on real scheduler state and timing.

## Draft issue

**Title:** Mutation job stays `running` forever when its scheduled `complete` fails

**Versions:** workpool 0.4.14, 0.4.16, 0.5.0; convex 1.46.0, 1.51.0. `recovery.ts` on `main` is unchanged.

**Steps:** `maxParallelism: 1`, enqueue mutation A (with `onComplete`), then B. A's `runMutationWrapper` succeeds; the `complete:complete` it schedules fails. We saw this on a cloud deployment as "Your request timed out performing too many system operations". The repro uses an injected throw instead. Repro: <link>

**Expected:** within 5 min, recovery frees A, A's `onComplete` runs, and B starts.

**Actual:** recovery runs for A every minute but leaves it `running`; `onComplete` never runs; B stays `pending`. Calling `complete:complete` by hand frees the slot.

```
12:53:27 worker.js:runMutationWrapper success
12:53:27 complete.js:complete         failed: injected error
12:58:27 recovery.js:recover          success  (A, attempt 0), repeats every minute
t+8min   A running, B pending, no onComplete
```

**Cause:** `recoveryHandler` handles a scheduled state of `failed`, `canceled` or missing, but has no `success` case. A's wrapper ended in `success`, so recovery never frees it.

---
written with claude-opus-5-5 in T3 Code
